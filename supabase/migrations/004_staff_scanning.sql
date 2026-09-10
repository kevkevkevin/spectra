-- Run after 003_event_management.sql. Safe to rerun without resetting roles or scans.
begin;

create table if not exists public.ticket_staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 assigned_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
-- Administrators already inherit scanner access. Remove any stale overlap every
-- time this migration runs so the staff table remains a distinct role list.
delete from public.ticket_staff s
using public.admins a
where a.user_id=s.user_id;
alter table public.ticket_staff enable row level security;
revoke all on public.ticket_staff from anon,authenticated;
grant select on public.ticket_staff to authenticated;
drop policy if exists "Admins read ticket staff" on public.ticket_staff;
create policy "Admins read ticket staff" on public.ticket_staff for select to authenticated using(public.is_ticket_admin());

create or replace function public.is_ticket_staff() returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_ticket_admin() or exists(select 1 from public.ticket_staff s where s.user_id=(select auth.uid()));
$$;
revoke all on function public.is_ticket_staff() from public,anon;
grant execute on function public.is_ticket_staff() to authenticated;

-- Role assignment never grants content, payment, review, or other admin powers.
create or replace function public.set_ticket_staff(p_user_id uuid,p_staff boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_user_id is null or p_staff is null then raise exception 'Invalid staff assignment'; end if;
 if not exists(select 1 from auth.users u where u.id=p_user_id) then raise exception 'User not found'; end if;
 -- Admins always have scanner access through is_ticket_staff(). Silently
 -- normalize both assignment and removal requests to no staff row.
 if exists(select 1 from public.admins a where a.user_id=p_user_id) then
  delete from public.ticket_staff s where s.user_id=p_user_id;
  return;
 end if;
 if p_staff then
  insert into public.ticket_staff(user_id,assigned_by) values(p_user_id,auth.uid()) on conflict(user_id) do nothing;
 else
  delete from public.ticket_staff s where s.user_id=p_user_id;
 end if;
end;
$$;
revoke all on function public.set_ticket_staff(uuid,boolean) from public,anon;
grant execute on function public.set_ticket_staff(uuid,boolean) to authenticated;

-- This directory is admin-only and exposes only the fields needed for assigning staff.
create or replace function public.list_ticket_users(p_search text default '',p_limit integer default 50)
returns table(user_id uuid,email text,display_name text,is_staff boolean,is_admin boolean,confirmed boolean)
language plpgsql stable security definer set search_path='' as $$
declare search_text text:=lower(left(trim(coalesce(p_search,'')),150));
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 return query
 with directory as (
  select u.id,u.email::text as mail,
   coalesce(nullif(left(trim(case when jsonb_typeof(u.raw_user_meta_data->'display_name')='string' then u.raw_user_meta_data->>'display_name' end),120),''),split_part(u.email,'@',1)) as name,
   exists(select 1 from public.ticket_staff s where s.user_id=u.id) as staff,
   exists(select 1 from public.admins a where a.user_id=u.id) as admin,
   u.email_confirmed_at is not null as verified
  from auth.users u where u.email is not null
 )
 select d.id,d.mail,d.name,d.staff,d.admin,d.verified from directory d
 where search_text='' or strpos(lower(d.mail),search_text)>0 or strpos(lower(d.name),search_text)>0
 order by d.staff desc,lower(d.mail),d.id
 limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;
revoke all on function public.list_ticket_users(text,integer) from public,anon;
grant execute on function public.list_ticket_users(text,integer) to authenticated;

-- Deleted events may still have valid issued tickets. The scanner needs their names only.
create or replace function public.list_scannable_ticket_events()
returns table(id uuid,title text,starts_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_ticket_staff() then raise exception 'Staff access required'; end if;
 return query select e.id,e.title,e.starts_at from public.ticket_events e order by e.starts_at desc nulls last,e.title,e.id;
end;
$$;
revoke all on function public.list_scannable_ticket_events() from public,anon;
grant execute on function public.list_scannable_ticket_events() to authenticated;

alter table public.issued_tickets add column if not exists food_redeemed_at timestamptz;
alter table public.issued_tickets add column if not exists food_redeemed_by uuid references auth.users(id);

-- A row lock serializes both counters. Retries preserve the first staff member and time.
-- Staff has no SELECT policy on other customers' orders, QR tokens, or receipt files.
create or replace function public.scan_ticket(p_token uuid,p_mode text,p_event_id uuid)
returns table(result text,ticket_id uuid,event_title text,guest_name text,seat_number integer,checked_in_at timestamptz,food_redeemed_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare t public.issued_tickets; o public.ticket_orders;
begin
 if not public.is_ticket_staff() then raise exception 'Staff access required'; end if;
 if p_mode is null or p_mode not in ('entry','food') then raise exception 'Invalid scan mode'; end if;
 if p_event_id is null then raise exception 'Choose an event'; end if;
 select i.* into t from public.issued_tickets i where i.token=p_token for update;
 if not found then result:='invalid_ticket'; return next; return; end if;
 select orders.* into o from public.ticket_orders orders where orders.id=t.order_id and orders.status='approved';
 if not found then result:='invalid_ticket'; return next; return; end if;
 if o.event_id<>p_event_id then result:='wrong_event'; return next; return; end if;

 if p_mode='entry' then
  if t.checked_in_at is not null then result:='already_used';
  else
   update public.issued_tickets i set checked_in_at=now(),checked_in_by=auth.uid() where i.id=t.id returning i.* into t;
   result:='success';
  end if;
 else
  if t.checked_in_at is null then result:='entry_required';
  elsif t.food_redeemed_at is not null then result:='already_used';
  else
   update public.issued_tickets i set food_redeemed_at=now(),food_redeemed_by=auth.uid() where i.id=t.id returning i.* into t;
   result:='success';
  end if;
 end if;
 ticket_id:=t.id;
 event_title:=o.event_title;
 guest_name:=o.customer_name;
 seat_number:=t.seat_number;
 checked_in_at:=t.checked_in_at;
 food_redeemed_at:=t.food_redeemed_at;
 return next;
end;
$$;
revoke all on function public.scan_ticket(uuid,text,uuid) from public,anon;
grant execute on function public.scan_ticket(uuid,text,uuid) to authenticated;

-- Keep existing admin QR links compatible while using the same locked entry transition.
create or replace function public.check_in_ticket(p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare event_id uuid; scan_result text;
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 select o.event_id into event_id from public.issued_tickets t join public.ticket_orders o on o.id=t.order_id where t.token=p_token;
 if not found then return false; end if;
 select s.result into scan_result from public.scan_ticket(p_token,'entry',event_id) s;
 return scan_result='success';
end;
$$;
revoke all on function public.check_in_ticket(uuid) from public,anon;
grant execute on function public.check_in_ticket(uuid) to authenticated;

commit;
