-- Run after 004_staff_scanning.sql. Safe to rerun without resetting campaign
-- settings, contestant edits, or votes.
begin;

create table if not exists public.voting_campaigns (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.ticket_events(id) on delete restrict,
 eyebrow text not null default '' check(length(eyebrow)<=80),
 headline text not null default '' check(length(headline)<=200),
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=3000),
 prize text not null default '' check(length(prize)<=500),
 hero_url text not null default '' check(
  length(hero_url)<=2000 and (
   hero_url='' or hero_url ~ '^https://[^[:space:]]+$' or hero_url ~ '^/assets/[a-zA-Z0-9_./-]+$'
  )
 ),
 active boolean not null default true,
 results_visible boolean not null default true,
 opens_at timestamptz,
 closes_at timestamptz,
 created_at timestamptz not null default now(),
 check(opens_at is null or closes_at is null or opens_at<closes_at)
);

create table if not exists public.contestants (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.voting_campaigns(id) on delete cascade,
 number integer not null check(number between 1 and 10000),
 name text not null check(length(trim(name)) between 1 and 120),
 description text not null default '' check(length(description)<=1500),
 image_url text not null default '' check(
  length(image_url)<=2000 and (
   image_url='' or image_url ~ '^https://[^[:space:]]+$' or image_url ~ '^/assets/[a-zA-Z0-9_./-]+$'
  )
 ),
 active boolean not null default true,
 position integer not null default 0 check(position between -10000 and 10000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(campaign_id,number),
 unique(campaign_id,id)
);

create table if not exists public.ticket_votes (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.voting_campaigns(id) on delete restrict,
 contestant_id uuid not null,
 issued_ticket_id uuid not null references public.issued_tickets(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 foreign key(campaign_id,contestant_id)
  references public.contestants(campaign_id,id) on delete restrict,
 unique(campaign_id,issued_ticket_id)
);

create index if not exists contestants_campaign_order
 on public.contestants(campaign_id,active,position,number,id);
create index if not exists ticket_votes_user_campaign
 on public.ticket_votes(user_id,campaign_id,created_at);
create index if not exists ticket_votes_contestant
 on public.ticket_votes(campaign_id,contestant_id);

-- Preserve historical vote meaning. Display copy and ordering remain editable,
-- while moving a campaign or contestant is blocked once votes depend on it.
create or replace function public.protect_voting_relationships() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='voting_campaigns' then
  if new.event_id is distinct from old.event_id
     and exists(select 1 from public.ticket_votes v where v.campaign_id=old.id) then
   raise exception 'A campaign with votes cannot change events';
  end if;
 elsif tg_table_name='contestants' then
  if new.campaign_id is distinct from old.campaign_id
     and exists(select 1 from public.ticket_votes v where v.contestant_id=old.id) then
   raise exception 'A contestant with votes cannot change campaigns';
  end if;
 end if;
 return new;
end;
$$;

drop trigger if exists protect_voting_campaign_event on public.voting_campaigns;
create trigger protect_voting_campaign_event before update of event_id
 on public.voting_campaigns for each row execute function public.protect_voting_relationships();
drop trigger if exists protect_contestant_campaign on public.contestants;
create trigger protect_contestant_campaign before update of campaign_id
 on public.contestants for each row execute function public.protect_voting_relationships();

create or replace function public.touch_contestant_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 return new;
end;
$$;
drop trigger if exists touch_contestant_updated_at on public.contestants;
create trigger touch_contestant_updated_at before update on public.contestants
 for each row execute function public.touch_contestant_updated_at();

-- Even privileged maintenance cannot silently rewrite vote history. A repair
-- must be an explicit migration that first removes this trigger.
create or replace function public.prevent_ticket_vote_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Votes are immutable';
end;
$$;
drop trigger if exists prevent_ticket_vote_mutation on public.ticket_votes;
create trigger prevent_ticket_vote_mutation before update or delete on public.ticket_votes
 for each row execute function public.prevent_ticket_vote_mutation();

-- Keep the ownership/event/status invariant at the table boundary as defense in
-- depth. Normal application callers still have no INSERT privilege on votes.
create or replace function public.validate_ticket_vote() returns trigger
language plpgsql set search_path='' as $$
begin
 if not exists(
  select 1
  from public.issued_tickets i
  join public.ticket_orders o on o.id=i.order_id
  join public.voting_campaigns c on c.id=new.campaign_id
  where i.id=new.issued_ticket_id
   and o.user_id=new.user_id
   and o.event_id=c.event_id
   and o.status='approved'
 ) then
  raise exception 'Vote ticket is not eligible';
 end if;
 return new;
end;
$$;
drop trigger if exists validate_ticket_vote on public.ticket_votes;
create trigger validate_ticket_vote before insert on public.ticket_votes
 for each row execute function public.validate_ticket_vote();

alter table public.voting_campaigns enable row level security;
alter table public.contestants enable row level security;
alter table public.ticket_votes enable row level security;

revoke all on public.voting_campaigns,public.contestants,public.ticket_votes from anon,authenticated;
grant select on public.voting_campaigns,public.contestants to anon,authenticated;
grant insert,update,delete on public.voting_campaigns,public.contestants to authenticated;
grant select on public.ticket_votes to authenticated;

drop policy if exists "Browse active voting campaigns" on public.voting_campaigns;
create policy "Browse active voting campaigns" on public.voting_campaigns
 for select to anon,authenticated using(active or public.is_ticket_admin());
drop policy if exists "Admins create voting campaigns" on public.voting_campaigns;
create policy "Admins create voting campaigns" on public.voting_campaigns
 for insert to authenticated with check(public.is_ticket_admin());
drop policy if exists "Admins update voting campaigns" on public.voting_campaigns;
create policy "Admins update voting campaigns" on public.voting_campaigns
 for update to authenticated using(public.is_ticket_admin()) with check(public.is_ticket_admin());
drop policy if exists "Admins delete voting campaigns" on public.voting_campaigns;
create policy "Admins delete voting campaigns" on public.voting_campaigns
 for delete to authenticated using(public.is_ticket_admin());

drop policy if exists "Browse active contestants" on public.contestants;
create policy "Browse active contestants" on public.contestants
 for select to anon,authenticated using(
  public.is_ticket_admin() or (
   active and exists(
    select 1 from public.voting_campaigns c where c.id=campaign_id and c.active
   )
  )
 );
drop policy if exists "Admins create contestants" on public.contestants;
create policy "Admins create contestants" on public.contestants
 for insert to authenticated with check(public.is_ticket_admin());
drop policy if exists "Admins update contestants" on public.contestants;
create policy "Admins update contestants" on public.contestants
 for update to authenticated using(public.is_ticket_admin()) with check(public.is_ticket_admin());
drop policy if exists "Admins delete contestants" on public.contestants;
create policy "Admins delete contestants" on public.contestants
 for delete to authenticated using(public.is_ticket_admin());

drop policy if exists "Owners or admins read ticket votes" on public.ticket_votes;
create policy "Owners or admins read ticket votes" on public.ticket_votes
 for select to authenticated using(user_id=(select auth.uid()) or public.is_ticket_admin());

-- Each call spends the caller's next unused issued ticket for this campaign.
-- The advisory lock serializes simultaneous calls from the same user/campaign,
-- while the unique constraint is the final one-ticket/one-vote guarantee.
create or replace function public.cast_contest_vote(p_campaign_id uuid,p_contestant_id uuid)
returns table(vote_id uuid,issued_ticket_id uuid,remaining bigint,contestant_id uuid)
language plpgsql security definer set search_path='' as $$
declare
 voter_id uuid:=(select auth.uid());
 campaign_event_id uuid;
 next_ticket_id uuid;
 saved_vote_id uuid;
 votes_remaining bigint;
begin
 if voter_id is null then raise exception 'Sign in required'; end if;
 if not exists(
  select 1 from auth.users u where u.id=voter_id and u.email_confirmed_at is not null
 ) then
  raise exception 'Confirm your email first';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(voter_id::text||':'||coalesce(p_campaign_id::text,''),0));

 select c.event_id into campaign_event_id
 from public.voting_campaigns c
 where c.id=p_campaign_id
  and c.active
  and (c.opens_at is null or c.opens_at<=statement_timestamp())
  and (c.closes_at is null or c.closes_at>statement_timestamp())
 for share;
 if not found then raise exception 'Voting is not open'; end if;

 perform 1 from public.contestants ct
 where ct.id=p_contestant_id and ct.campaign_id=p_campaign_id and ct.active
 for share;
 if not found then raise exception 'Contestant is not available'; end if;

 select i.id into next_ticket_id
 from public.issued_tickets i
 join public.ticket_orders o on o.id=i.order_id
 left join public.ticket_votes v
  on v.campaign_id=p_campaign_id and v.issued_ticket_id=i.id
 where o.user_id=voter_id
  and o.event_id=campaign_event_id
  and o.status='approved'
  and v.id is null
 order by o.created_at,o.id,i.seat_number,i.id
 limit 1 for update of i;
 if not found then raise exception 'No unused eligible ticket remains'; end if;

 insert into public.ticket_votes(campaign_id,contestant_id,issued_ticket_id,user_id)
 values(p_campaign_id,p_contestant_id,next_ticket_id,voter_id)
 returning id into saved_vote_id;

 select count(*) into votes_remaining
 from public.issued_tickets i
 join public.ticket_orders o on o.id=i.order_id
 left join public.ticket_votes v
  on v.campaign_id=p_campaign_id and v.issued_ticket_id=i.id
 where o.user_id=voter_id
  and o.event_id=campaign_event_id
  and o.status='approved'
  and v.id is null;

 vote_id:=saved_vote_id;
 issued_ticket_id:=next_ticket_id;
 remaining:=votes_remaining;
 contestant_id:=p_contestant_id;
 return next;
end;
$$;
revoke all on function public.cast_contest_vote(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cast_contest_vote(uuid,uuid) to authenticated;

-- Counts are scoped exclusively to the signed-in caller and reveal no ticket,
-- order, or other voter identifiers.
create or replace function public.contest_vote_status(p_campaign_id uuid)
returns table(eligible bigint,used bigint,remaining bigint)
language plpgsql stable security definer set search_path='' as $$
declare
 voter_id uuid:=(select auth.uid());
 campaign_event_id uuid;
 eligible_count bigint;
 used_count bigint;
begin
 if voter_id is null then raise exception 'Sign in required'; end if;
 select c.event_id into campaign_event_id
 from public.voting_campaigns c
 where c.id=p_campaign_id and c.active;
 if not found then raise exception 'Campaign is not available'; end if;

 select count(*) into eligible_count
 from public.issued_tickets i
 join public.ticket_orders o on o.id=i.order_id
 where o.user_id=voter_id
  and o.event_id=campaign_event_id
  and o.status='approved';

 select count(*) into used_count
 from public.ticket_votes v
 where v.user_id=voter_id and v.campaign_id=p_campaign_id;

 eligible:=eligible_count;
 used:=used_count;
 remaining:=greatest(eligible_count-used_count,0);
 return next;
end;
$$;
revoke all on function public.contest_vote_status(uuid) from public,anon,authenticated;
grant execute on function public.contest_vote_status(uuid) to authenticated;

-- Public results intentionally expose no voter or ticket rows. When results are
-- hidden, visitors receive null result fields while admins retain the tally.
create or replace function public.contest_public_tally(p_campaign_id uuid)
returns table(
 id uuid,number integer,name text,description text,image_url text,"position" integer,
 vote_count bigint,share_percent numeric
)
language sql stable security definer set search_path='' as $$
 with requested_campaign as (
  select c.id,c.results_visible,public.is_ticket_admin() as caller_is_admin
  from public.voting_campaigns c
  where c.id=p_campaign_id and (c.active or public.is_ticket_admin())
 ), contestant_counts as (
  select ct.id,ct.number,ct.name,ct.description,ct.image_url,ct.position,
   rc.results_visible,rc.caller_is_admin,count(v.id)::bigint as raw_vote_count
  from requested_campaign rc
  join public.contestants ct on ct.campaign_id=rc.id
  left join public.ticket_votes v
   on v.campaign_id=rc.id and v.contestant_id=ct.id
  where ct.active or rc.caller_is_admin
  group by ct.id,ct.number,ct.name,ct.description,ct.image_url,ct.position,rc.results_visible,rc.caller_is_admin
 ), totals as (
  select cc.*,sum(cc.raw_vote_count) over()::numeric as total_votes
  from contestant_counts cc
 )
 select t.id,t.number,t.name,t.description,t.image_url,t.position,
  case when t.results_visible or t.caller_is_admin then t.raw_vote_count else null::bigint end,
  case when t.results_visible or t.caller_is_admin then
   coalesce(round(t.raw_vote_count::numeric*100/nullif(t.total_votes,0),2),0::numeric)
  else null::numeric end
 from totals t
 order by t.position,t.number,t.id;
$$;
revoke all on function public.contest_public_tally(uuid) from public,anon,authenticated;
grant execute on function public.contest_public_tally(uuid) to anon,authenticated;

-- Stable IDs let the application link directly to the default campaign while
-- ON CONFLICT DO NOTHING preserves all production edits on migration reruns.
insert into public.voting_campaigns(
 id,event_id,eyebrow,headline,title,description,prize,hero_url,active,results_visible
) values (
 '30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',
 'Elimination rounds',
 'TOP 21 Official Contenders',
 'Spectra’s Next Singing Idol',
 'The Top 21 official contenders take the Bora stage. Two elimination nights. One house vote. One star.',
 'Grand prize · 100,000 PHP',
 '/assets/reference/contest-top21.jpg',true,true
) on conflict(id) do nothing;

insert into public.contestants(id,campaign_id,number,name,description,image_url,position) values
 ('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'Contender 01','','/assets/contest/c01.jpg',1),
 ('31000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',2,'Contender 02','','/assets/contest/c02.jpg',2),
 ('31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',3,'Contender 03','','/assets/contest/c03.jpg',3),
 ('31000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001',4,'Contender 04','','/assets/contest/c04.jpg',4),
 ('31000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001',5,'Contender 05','','/assets/contest/c05.jpg',5),
 ('31000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001',6,'Contender 06','','/assets/contest/c06.jpg',6),
 ('31000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000001',7,'Contender 07','','/assets/contest/c07.jpg',7),
 ('31000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000001',8,'Contender 08','','/assets/contest/c08.jpg',8),
 ('31000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001',9,'Contender 09','','/assets/contest/c09.jpg',9),
 ('31000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000001',10,'Contender 10','','/assets/contest/c10.jpg',10),
 ('31000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001',11,'Contender 11','','/assets/contest/c11.jpg',11),
 ('31000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000001',12,'Contender 12','','/assets/contest/c12.jpg',12),
 ('31000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000001',13,'Contender 13','','/assets/contest/c13.jpg',13),
 ('31000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001',14,'Contender 14','','/assets/contest/c14.jpg',14),
 ('31000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000001',15,'Contender 15','','/assets/contest/c15.jpg',15),
 ('31000000-0000-4000-8000-000000000016','30000000-0000-4000-8000-000000000001',16,'Contender 16','','/assets/contest/c16.jpg',16),
 ('31000000-0000-4000-8000-000000000017','30000000-0000-4000-8000-000000000001',17,'Contender 17','','/assets/contest/c17.jpg',17),
 ('31000000-0000-4000-8000-000000000018','30000000-0000-4000-8000-000000000001',18,'Contender 18','','/assets/contest/c18.jpg',18),
 ('31000000-0000-4000-8000-000000000019','30000000-0000-4000-8000-000000000001',19,'Contender 19','','/assets/contest/c19.jpg',19),
 ('31000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000001',20,'Contender 20','','/assets/contest/c20.jpg',20),
 ('31000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000001',21,'Contender 21','','/assets/contest/c21.jpg',21)
on conflict(id) do nothing;

commit;
