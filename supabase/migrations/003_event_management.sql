-- Run after 002_ticketing.sql. Safe to rerun; reopening happens only on first application.
begin;
do $$
declare first_run boolean;
begin
 select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ticket_events' and column_name='deleted_at') into first_run;
 alter table public.ticket_events add column if not exists banner_url text not null default '';
 alter table public.ticket_events add column if not exists deleted_at timestamptz;
 alter table public.ticket_events drop constraint if exists ticket_events_check;
 alter table public.ticket_events alter column active set default true;
 alter table public.ticket_orders alter column event_starts_at drop not null;
 if not exists(select 1 from pg_constraint where conname='ticket_event_banner_url' and conrelid='public.ticket_events'::regclass) then
  alter table public.ticket_events add constraint ticket_event_banner_url check(length(banner_url)<=2000 and (banner_url='' or banner_url ~ '^https://[^[:space:]]+$' or banner_url ~ '^/assets/[a-zA-Z0-9_./-]+$'));
 end if;
 if first_run then
  update public.ticket_events set active=true where deleted_at is null;
  update public.ticket_payment_settings set enabled=true where length(trim(stc_pay))>0 or (length(trim(bank_name))>0 and length(trim(iban))>0);
 end if;
end;
$$;
drop policy if exists "Browse ticket events" on public.ticket_events;
create policy "Browse ticket events" on public.ticket_events for select using(deleted_at is null or public.is_ticket_admin());
drop policy if exists "Admins update events" on public.ticket_events;
create policy "Admins update events" on public.ticket_events for update to authenticated using(public.is_ticket_admin() and deleted_at is null) with check(public.is_ticket_admin() and deleted_at is null);
drop policy if exists "Admins insert events" on public.ticket_events;
create policy "Admins insert events" on public.ticket_events for insert to authenticated with check(public.is_ticket_admin() and deleted_at is null);
revoke update on public.ticket_events from authenticated;
grant update(title,description,venue,starts_at,price_minor,capacity,active,banner_url) on public.ticket_events to authenticated;
create or replace function public.delete_ticket_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 update public.ticket_events set active=false,deleted_at=coalesce(deleted_at,now()) where id=p_id;
 if not found then raise exception 'Event not found'; end if;
end;
$$;
revoke all on function public.delete_ticket_event(uuid) from public;
grant execute on function public.delete_ticket_event(uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ticket-banners','ticket-banners',true,4194304,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
drop policy if exists "Public ticket banners" on storage.objects;
create policy "Public ticket banners" on storage.objects for select using(bucket_id='ticket-banners');
drop policy if exists "Staff upload ticket banners" on storage.objects;
create policy "Staff upload ticket banners" on storage.objects for insert to authenticated with check(bucket_id='ticket-banners' and public.is_ticket_admin());
drop policy if exists "Staff delete ticket banners" on storage.objects;
create policy "Staff delete ticket banners" on storage.objects for delete to authenticated using(bucket_id='ticket-banners' and public.is_ticket_admin());
create or replace function public.submit_ticket_order(p_id uuid,p_event_id uuid,p_quantity integer,p_name text,p_phone text,p_receipt_path text,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.ticket_events; existing public.ticket_orders; mail text; reserved integer;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into existing from public.ticket_orders where id=p_id;
 if found then
  if existing.user_id<>auth.uid() then raise exception 'Order unavailable'; end if;
  return existing.id;
 end if;
 select email into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then raise exception 'Confirm your email first'; end if;
 if not exists(select 1 from public.ticket_payment_settings where id and enabled) then raise exception 'Ticket sales are not open'; end if;
 if p_quantity is null or p_quantity not between 1 and 10 or length(trim(p_name)) not between 1 and 120 or length(p_phone) not between 6 and 30 or length(p_note)>1500 then raise exception 'Invalid order details'; end if;
 if (select count(*) from public.ticket_orders where user_id=auth.uid() and status='pending')>=5 or (select count(*) from public.ticket_orders where user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Too many requests; please contact Spectra'; end if;
 select * into e from public.ticket_events where id=p_event_id for update;
 if not found or not e.active or e.deleted_at is not null then raise exception 'This event is not available'; end if;
 select coalesce(sum(quantity),0) into reserved from public.ticket_orders where event_id=p_event_id and status in ('pending','approved');
 if reserved+p_quantity>e.capacity then raise exception 'Not enough seats remain; please contact Spectra'; end if;
 if p_receipt_path not like auth.uid()::text||'/'||p_id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ticket-receipts' and name=p_receipt_path) then raise exception 'Upload a receipt first'; end if;
 insert into public.ticket_orders(id,user_id,event_id,customer_name,customer_email,customer_phone,event_title,event_venue,event_starts_at,quantity,unit_price_minor,receipt_path,note)
 values(p_id,auth.uid(),e.id,trim(p_name),mail,p_phone,e.title,e.venue,e.starts_at,p_quantity,e.price_minor,p_receipt_path,p_note);
 insert into public.ticket_notifications(order_id,kind) values(p_id,'submitted');
 return p_id;
end;
$$;

create or replace function public.ticket_availability() returns table(event_id uuid,remaining bigint) language sql stable security definer set search_path='' as $$
 select e.id,greatest(0,e.capacity-coalesce(sum(o.quantity) filter(where o.status in ('pending','approved')),0))
 from public.ticket_events e left join public.ticket_orders o on o.event_id=e.id where e.deleted_at is null group by e.id;
$$;
commit;
