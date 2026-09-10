-- Run after 001_content.sql in Supabase SQL Editor. Run once, as project owner.
begin;
create function public.is_ticket_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_ticket_admin() from public;
grant execute on function public.is_ticket_admin() to anon, authenticated;

create table public.ticket_events (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 1 and 150),
 description text not null default '' check(length(description)<=1500),
 venue text not null check(length(venue) between 1 and 250),
 starts_at timestamptz,
 price_minor integer not null check(price_minor between 100 and 10000000),
 capacity integer not null default 100 check(capacity between 1 and 100000),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 check(not active or starts_at is not null)
);
create table public.ticket_payment_settings (
 id boolean primary key default true check(id),
 payee text not null default 'Spectra Performing Arts & Production' check(length(payee)<=200),
 stc_pay text not null default '' check(length(stc_pay)<=30),
 bank_name text not null default '' check(length(bank_name)<=100),
 iban text not null default '' check(length(iban)<=40),
 instructions text not null default '' check(length(instructions)<=1000),
 enabled boolean not null default false,
 check(not enabled or length(stc_pay)>0 or (length(bank_name)>0 and length(iban)>0))
);
insert into public.ticket_payment_settings(id,stc_pay,instructions) values(true,'050 863 4546','Pay the exact total, then attach a clear screenshot of the payment receipt.');
-- Screenshot prices are drafts until the owner confirms payment details and event dates.
insert into public.ticket_events(id,title,description,venue,price_minor) values
 ('10000000-0000-4000-8000-000000000001','Spectra Live Night','An evening with the house — live voices, lights, and the Spectra stage.','Bora Cafe, Ground Floor, Jeddah',5000),
 ('10000000-0000-4000-8000-000000000002','Spectra’s Next Singing Idol','A seat for a night of extraordinary voices on the Spectra stage.','Bora Cafe, Ground Floor, Jeddah',7500);

create table public.ticket_orders (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 event_id uuid not null references public.ticket_events(id),
 customer_name text not null check(length(trim(customer_name)) between 1 and 120),
 customer_email text not null,
 customer_phone text not null check(length(customer_phone) between 6 and 30),
 event_title text not null,
 event_venue text not null,
 event_starts_at timestamptz not null,
 quantity integer not null check(quantity between 1 and 10),
 unit_price_minor integer not null check(unit_price_minor>0),
 total_minor integer generated always as (quantity * unit_price_minor) stored,
 receipt_path text not null unique,
 note text not null default '' check(length(note)<=1500),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '' check(length(review_note)<=1500),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index ticket_orders_customer on public.ticket_orders(user_id,created_at desc);
create index ticket_orders_queue on public.ticket_orders(status,created_at);
create index ticket_orders_capacity on public.ticket_orders(event_id,status);
create table public.issued_tickets (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.ticket_orders(id),
 seat_number integer not null,
 token uuid not null unique default gen_random_uuid(),
 checked_in_at timestamptz,
 checked_in_by uuid references auth.users(id),
 unique(order_id,seat_number)
);
create table public.ticket_notifications (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.ticket_orders(id),
 kind text not null check(kind in ('submitted','approved','rejected')),
 state text not null default 'queued' check(state in ('queued','sending','sent','failed')),
 attempts integer not null default 0,
 locked_at timestamptz,
 sent_at timestamptz,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now(),
 unique(order_id,kind)
);
create index ticket_notifications_queue on public.ticket_notifications(state,created_at);

alter table public.ticket_events enable row level security;
alter table public.ticket_payment_settings enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.issued_tickets enable row level security;
alter table public.ticket_notifications enable row level security;
revoke all on public.ticket_events,public.ticket_payment_settings,public.ticket_orders,public.issued_tickets,public.ticket_notifications from anon,authenticated;
grant select on public.ticket_events,public.ticket_payment_settings to anon,authenticated;
grant insert,update on public.ticket_events,public.ticket_payment_settings to authenticated;
grant select on public.ticket_orders,public.issued_tickets,public.ticket_notifications to authenticated;
grant all on public.ticket_notifications,public.ticket_orders to service_role;
create policy "Browse ticket events" on public.ticket_events for select using(true);
create policy "Admins insert events" on public.ticket_events for insert to authenticated with check(public.is_ticket_admin());
create policy "Admins update events" on public.ticket_events for update to authenticated using(public.is_ticket_admin()) with check(public.is_ticket_admin());
create policy "Read payment instructions" on public.ticket_payment_settings for select using(true);
create policy "Admins update payment instructions" on public.ticket_payment_settings for update to authenticated using(public.is_ticket_admin()) with check(public.is_ticket_admin());
create policy "Read own orders or admin queue" on public.ticket_orders for select to authenticated using(user_id=(select auth.uid()) or public.is_ticket_admin());
create policy "Read own issued tickets or admin tickets" on public.issued_tickets for select to authenticated using(exists(select 1 from public.ticket_orders o where o.id=order_id and (o.user_id=(select auth.uid()) or public.is_ticket_admin())));
create policy "Admins read notification delivery" on public.ticket_notifications for select to authenticated using(public.is_ticket_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ticket-receipts','ticket-receipts',false,4194304,array['image/jpeg','image/png','image/webp']);
-- A definer function prevents the Storage policy from recursively querying itself.
create function public.can_upload_ticket_receipt() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (select count(*) from storage.objects s where s.bucket_id='ticket-receipts' and (storage.foldername(s.name))[1]=auth.uid()::text and s.created_at>now()-interval '1 hour')<20;
$$;
revoke all on function public.can_upload_ticket_receipt() from public;
grant execute on function public.can_upload_ticket_receipt() to authenticated;
create policy "Upload own ticket receipts" on storage.objects for insert to authenticated with check(
 bucket_id='ticket-receipts' and (storage.foldername(name))[1]=(select auth.uid())::text
 and public.can_upload_ticket_receipt()
);
create policy "View own receipts or admin receipts" on storage.objects for select to authenticated using(bucket_id='ticket-receipts' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.is_ticket_admin()));
create policy "Remove unattached own receipts" on storage.objects for delete to authenticated using(bucket_id='ticket-receipts' and (storage.foldername(name))[1]=(select auth.uid())::text and not exists(select 1 from public.ticket_orders where receipt_path=name));

create function public.submit_ticket_order(p_id uuid,p_event_id uuid,p_quantity integer,p_name text,p_phone text,p_receipt_path text,p_note text default '') returns uuid
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
 if not found or not e.active or e.starts_at<=now() then raise exception 'This event is not available'; end if;
 select coalesce(sum(quantity),0) into reserved from public.ticket_orders where event_id=p_event_id and status in ('pending','approved');
 if reserved+p_quantity>e.capacity then raise exception 'Not enough seats remain; please contact Spectra'; end if;
 if p_receipt_path not like auth.uid()::text||'/'||p_id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='ticket-receipts' and name=p_receipt_path) then raise exception 'Upload a receipt first'; end if;
 insert into public.ticket_orders(id,user_id,event_id,customer_name,customer_email,customer_phone,event_title,event_venue,event_starts_at,quantity,unit_price_minor,receipt_path,note)
 values(p_id,auth.uid(),e.id,trim(p_name),mail,p_phone,e.title,e.venue,e.starts_at,p_quantity,e.price_minor,p_receipt_path,p_note);
 insert into public.ticket_notifications(order_id,kind) values(p_id,'submitted');
 return p_id;
end;
$$;

create function public.review_ticket_order(p_id uuid,p_decision text,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare o public.ticket_orders;
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_note is null or length(p_note)>1500 then raise exception 'Invalid decision'; end if;
 if p_decision='rejected' and length(trim(p_note))=0 then raise exception 'A rejection reason is required'; end if;
 select * into o from public.ticket_orders where id=p_id for update;
 if not found then raise exception 'Order not found'; end if;
 if o.status=p_decision then return; end if;
 if o.status<>'pending' then raise exception 'This request has already been reviewed'; end if;
 update public.ticket_orders set status=p_decision,review_note=trim(p_note),reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
 if p_decision='approved' then insert into public.issued_tickets(order_id,seat_number) select p_id,generate_series(1,o.quantity); end if;
 insert into public.ticket_notifications(order_id,kind) values(p_id,p_decision);
end;
$$;

create function public.check_in_ticket(p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 update public.issued_tickets t set checked_in_at=now(),checked_in_by=auth.uid() where token=p_token and checked_in_at is null and exists(select 1 from public.ticket_orders o where o.id=t.order_id and o.status='approved');
 return found;
end;
$$;
revoke all on function public.submit_ticket_order(uuid,uuid,integer,text,text,text,text),public.review_ticket_order(uuid,text,text),public.check_in_ticket(uuid) from public;
grant execute on function public.submit_ticket_order(uuid,uuid,integer,text,text,text,text),public.review_ticket_order(uuid,text,text),public.check_in_ticket(uuid) to authenticated;

-- Availability exposes counts only; order and customer information stays private.
create function public.ticket_availability() returns table(event_id uuid,remaining bigint) language sql stable security definer set search_path='' as $$
 select e.id,greatest(0,e.capacity-coalesce(sum(o.quantity) filter(where o.status in ('pending','approved')),0))
 from public.ticket_events e left join public.ticket_orders o on o.event_id=e.id group by e.id;
$$;
revoke all on function public.ticket_availability() from public;
grant execute on function public.ticket_availability() to anon,authenticated;

create function public.requeue_ticket_emails(p_order_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 update public.ticket_notifications set attempts=0,state='queued',locked_at=null,last_error=null
 where (p_order_id is null or order_id=p_order_id) and attempts>=10
 and (state='failed' or (state='sending' and locked_at<now()-interval '10 minutes'));
end;
$$;
revoke all on function public.requeue_ticket_emails(uuid) from public;
grant execute on function public.requeue_ticket_emails(uuid) to authenticated;

create function public.claim_ticket_email(p_id uuid) returns setof public.ticket_notifications language sql security definer set search_path='' as $$
 update public.ticket_notifications set state='sending',attempts=attempts+1,locked_at=now()
 where id=p_id and attempts<10 and (state in ('queued','failed') or (state='sending' and locked_at<now()-interval '10 minutes')) returning *;
$$;
revoke all on function public.claim_ticket_email(uuid) from public,anon,authenticated;
grant execute on function public.claim_ticket_email(uuid) to service_role;
commit;
