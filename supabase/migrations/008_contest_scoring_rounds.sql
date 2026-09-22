-- Independent Elimination, Semi-finals, and Grand Finals scorecards.
-- Run after 007. Existing cards become Elimination cards. Safe to rerun.
begin;

create table if not exists public.contest_scoring_rounds (
 campaign_id uuid not null references public.voting_campaigns(id) on delete cascade,
 round text not null check(round in ('elimination','semi_final','grand_final')),
 scoring_open boolean not null default false,
 results_visible boolean not null default false,
 opened_at timestamptz,
 primary key(campaign_id,round)
);

insert into public.contest_scoring_rounds(campaign_id,round,scoring_open,results_visible,opened_at)
select s.campaign_id,r.round,
 case when r.round='elimination' then s.scoring_open else false end,
 case when r.round='elimination' then s.results_visible else false end,
 case when r.round='elimination' and (s.scoring_open or exists(select 1 from public.contest_scorecards c where c.campaign_id=s.campaign_id)) then now() else null end
from public.contest_scoring_settings s cross join (values ('elimination'),('semi_final'),('grand_final')) as r(round)
on conflict(campaign_id,round) do nothing;

create or replace function public.seed_contest_scoring_rounds() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.contest_scoring_rounds(campaign_id,round)
 values(new.id,'elimination'),(new.id,'semi_final'),(new.id,'grand_final') on conflict do nothing;
 return new;
end;
$$;
drop trigger if exists seed_contest_scoring_rounds on public.voting_campaigns;
create trigger seed_contest_scoring_rounds after insert on public.voting_campaigns
for each row execute function public.seed_contest_scoring_rounds();

alter table public.contest_scorecards add column if not exists round text not null default 'elimination';
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.contest_scorecards'::regclass and conname='contest_scorecards_round_check') then
  alter table public.contest_scorecards add constraint contest_scorecards_round_check
   check(round in ('elimination','semi_final','grand_final'));
 end if;
 if exists(select 1 from pg_constraint where conrelid='public.contest_scorecards'::regclass and conname='contest_scorecards_campaign_id_contestant_id_judge_id_key') then
  alter table public.contest_scorecards drop constraint contest_scorecards_campaign_id_contestant_id_judge_id_key;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.contest_scorecards'::regclass and conname='contest_scorecards_campaign_round_contestant_judge_key') then
  alter table public.contest_scorecards add constraint contest_scorecards_campaign_round_contestant_judge_key
   unique(campaign_id,round,contestant_id,judge_id);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.contest_scorecards'::regclass and conname='contest_scorecards_campaign_round_fkey') then
  alter table public.contest_scorecards add constraint contest_scorecards_campaign_round_fkey
   foreign key(campaign_id,round) references public.contest_scoring_rounds(campaign_id,round) on delete restrict;
 end if;
end $$;
create index if not exists contest_scorecards_campaign_round on public.contest_scorecards(campaign_id,round,contestant_id);

-- Later rounds contain only the contenders explicitly advanced by an admin.
create table if not exists public.contest_round_entries (
 campaign_id uuid not null,
 round text not null check(round in ('semi_final','grand_final')),
 contestant_id uuid not null,
 primary key(campaign_id,round,contestant_id),
 foreign key(campaign_id,round) references public.contest_scoring_rounds(campaign_id,round) on delete cascade,
 foreign key(campaign_id,contestant_id) references public.contestants(campaign_id,id) on delete restrict
);

alter table public.contest_scoring_rounds enable row level security;
alter table public.contest_round_entries enable row level security;
revoke all on public.contest_scoring_rounds,public.contest_round_entries from anon,authenticated;
grant select on public.contest_scoring_rounds to anon,authenticated;
grant select on public.contest_round_entries to authenticated;
drop policy if exists "Read scoring rounds" on public.contest_scoring_rounds;
create policy "Read scoring rounds" on public.contest_scoring_rounds for select using(true);
drop policy if exists "Read round entries as judge or admin" on public.contest_round_entries;
create policy "Read round entries as judge or admin" on public.contest_round_entries for select to authenticated
using(public.is_contest_judge() or public.is_ticket_admin());

create or replace function public.set_contest_round_entries(p_campaign_id uuid,p_round text,p_contestants jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare contestant uuid;
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_round is null or p_round not in ('semi_final','grand_final') or p_contestants is null
  or jsonb_typeof(p_contestants) is distinct from 'array' or jsonb_array_length(p_contestants)>10000 then
  raise exception 'Invalid round entries';
 end if;
 perform 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=p_round for update;
 if not found then raise exception 'Scoring round not found'; end if;
 if exists(select 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=p_round and opened_at is not null)
  or exists(select 1 from public.contest_scorecards where campaign_id=p_campaign_id and round=p_round) then
  raise exception 'Round entries are locked after scoring opens';
 end if;
 if exists(select 1 from jsonb_array_elements(p_contestants) as e(value) where jsonb_typeof(e.value)<>'string')
  or (select count(*) from jsonb_array_elements_text(p_contestants))
     <>(select count(distinct value) from jsonb_array_elements_text(p_contestants) as e(value)) then
  raise exception 'Invalid or duplicate round entries';
 end if;
 for contestant in select value::uuid from jsonb_array_elements_text(p_contestants) as e(value) loop
  if not exists(select 1 from public.contestants c where c.campaign_id=p_campaign_id and c.id=contestant and c.active) then
   raise exception 'Contestant is unavailable';
  end if;
  if not exists(select 1 from public.contest_scorecards card where card.campaign_id=p_campaign_id
    and card.contestant_id=contestant and card.round=case p_round when 'semi_final' then 'elimination' else 'semi_final' end) then
   raise exception 'Advance only contenders scored in the previous round';
  end if;
 end loop;
 delete from public.contest_round_entries where campaign_id=p_campaign_id and round=p_round;
 insert into public.contest_round_entries(campaign_id,round,contestant_id)
 select p_campaign_id,p_round,value::uuid from jsonb_array_elements_text(p_contestants) as e(value);
end;
$$;
revoke all on function public.set_contest_round_entries(uuid,text,jsonb) from public,anon;
grant execute on function public.set_contest_round_entries(uuid,text,jsonb) to authenticated;

create or replace function public.set_contest_round_state(p_campaign_id uuid,p_round text,p_scoring_open boolean,p_results_visible boolean) returns void
language plpgsql security definer set search_path='' as $$
declare previous_round text;
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_round is null or p_round not in ('elimination','semi_final','grand_final') or p_scoring_open is null or p_results_visible is null then
  raise exception 'Invalid round settings';
 end if;
 perform 1 from public.contest_scoring_settings where campaign_id=p_campaign_id for update;
 if not found then raise exception 'Campaign not found'; end if;
 perform 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=p_round for update;
 if not found then raise exception 'Scoring round not found'; end if;
 if p_scoring_open then
  if not exists(select 1 from public.voting_campaigns where id=p_campaign_id and active) then raise exception 'Campaign is inactive'; end if;
  if exists(select 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round<>p_round and scoring_open) then
   raise exception 'Close the current round before opening another';
  end if;
  if p_round<>'elimination' then
   previous_round:=case p_round when 'semi_final' then 'elimination' else 'semi_final' end;
   if not exists(select 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=previous_round
    and opened_at is not null and not scoring_open) then raise exception 'Close the previous round first'; end if;
   if not exists(select 1 from public.contest_round_entries where campaign_id=p_campaign_id and round=p_round) then
    raise exception 'Select advancing contenders first';
   end if;
  end if;
 end if;
 update public.contest_scoring_rounds set scoring_open=p_scoring_open,results_visible=p_results_visible,
  opened_at=case when p_scoring_open then coalesce(opened_at,now()) else opened_at end
 where campaign_id=p_campaign_id and round=p_round;
end;
$$;
revoke all on function public.set_contest_round_state(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.set_contest_round_state(uuid,text,boolean,boolean) to authenticated;

-- Remove the old campaign-wide RPC so it cannot bypass round eligibility or opening rules.
drop function if exists public.submit_contest_scorecard(uuid,uuid,jsonb);
create or replace function public.submit_contest_scorecard(p_campaign_id uuid,p_contestant_id uuid,p_round text,p_scores jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry jsonb; criterion_id uuid; value numeric(4,2); seen uuid[]:='{}'; card_id uuid;
begin
 if not public.is_contest_judge() then raise exception 'Judge access required'; end if;
 if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
 if p_campaign_id is null or p_contestant_id is null or p_round is null or p_round not in ('elimination','semi_final','grand_final')
  or p_scores is null or jsonb_typeof(p_scores) is distinct from 'array' or jsonb_array_length(p_scores)<>7 then raise exception 'Score every criterion'; end if;
 perform 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=p_round and scoring_open for share;
 if not found then raise exception 'Scoring is closed'; end if;
 if not exists(select 1 from public.voting_campaigns where id=p_campaign_id and active) then raise exception 'Campaign is inactive'; end if;
 if not exists(select 1 from public.contestants where id=p_contestant_id and campaign_id=p_campaign_id and active) then raise exception 'Contestant is unavailable'; end if;
 if p_round<>'elimination' and not exists(select 1 from public.contest_round_entries
  where campaign_id=p_campaign_id and round=p_round and contestant_id=p_contestant_id) then raise exception 'Contestant has not advanced'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_campaign_id::text||p_contestant_id::text||p_round,0));
 for entry in select item from jsonb_array_elements(p_scores) as ballot(item) loop
  if jsonb_typeof(entry->'criterion_id')<>'string' or jsonb_typeof(entry->'score')<>'number' then raise exception 'Invalid score'; end if;
  criterion_id:=(entry->>'criterion_id')::uuid;
  if (entry->>'score') !~ '^(10([.]0{1,2})?|[0-9]([.][0-9]{1,2})?)$' then raise exception 'Scores must be from 0 to 10 with up to two decimals'; end if;
  value:=(entry->>'score')::numeric;
  if criterion_id=any(seen) or not exists(select 1 from public.contest_scoring_criteria where campaign_id=p_campaign_id and id=criterion_id) then raise exception 'Invalid criterion'; end if;
  seen:=array_append(seen,criterion_id);
 end loop;
 if (select count(*) from public.contest_scoring_criteria where campaign_id=p_campaign_id)<>7 then raise exception 'Rubric is incomplete'; end if;
 insert into public.contest_scorecards(campaign_id,contestant_id,judge_id,round)
 values(p_campaign_id,p_contestant_id,auth.uid(),p_round)
 on conflict(campaign_id,round,contestant_id,judge_id) do update set submitted_at=now()
 returning id into card_id;
 delete from public.contest_scores where scorecard_id=card_id;
 insert into public.contest_scores(scorecard_id,campaign_id,criterion_id,score)
 select card_id,p_campaign_id,(item->>'criterion_id')::uuid,(item->>'score')::numeric
 from jsonb_array_elements(p_scores) as ballot(item);
 return card_id;
end;
$$;
revoke all on function public.submit_contest_scorecard(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.submit_contest_scorecard(uuid,uuid,text,jsonb) to authenticated;

drop function if exists public.contest_judge_leaderboard(uuid);
create or replace function public.contest_judge_leaderboard(p_campaign_id uuid,p_round text)
returns table(contestant_id uuid,number integer,name text,judge_count integer,
 voice_points numeric,stage_points numeric,audience_points numeric,total_points numeric,rank_position bigint)
language plpgsql stable security definer set search_path='' as $$
declare admin_view boolean:=public.is_ticket_admin();
begin
 if p_round not in ('elimination','semi_final','grand_final') then return; end if;
 if not admin_view and not exists(
  select 1 from public.contest_scoring_rounds s join public.voting_campaigns campaign on campaign.id=s.campaign_id
  where s.campaign_id=p_campaign_id and s.round=p_round and s.results_visible and campaign.active
 ) then return; end if;
 return query
 with judge_cards as (
  select card.contestant_id,card.id,
   sum(score.score*criterion.weight/10) filter(where criterion.category='voice') as voice,
   sum(score.score*criterion.weight/10) filter(where criterion.category='stage') as stage,
   sum(score.score*criterion.weight/10) filter(where criterion.category='audience') as audience,
   sum(score.score*criterion.weight/10) as total
  from public.contest_scorecards card
  join public.contest_scores score on score.scorecard_id=card.id
  join public.contest_scoring_criteria criterion on criterion.id=score.criterion_id
  where card.campaign_id=p_campaign_id and card.round=p_round
  group by card.contestant_id,card.id having count(*)=7
 ), averages as (
  select cards.contestant_id,count(*)::integer as judges,
   round(avg(cards.voice),2) as voice,round(avg(cards.stage),2) as stage,
   round(avg(cards.audience),2) as audience,round(avg(cards.total),2) as total
  from judge_cards cards group by cards.contestant_id
 )
 select contestant.id,contestant.number,contestant.name,coalesce(avg_score.judges,0),
  avg_score.voice,avg_score.stage,avg_score.audience,avg_score.total,
  case when avg_score.judges>0 then dense_rank() over(
   order by avg_score.total desc nulls last,avg_score.voice desc nulls last,
    avg_score.stage desc nulls last,avg_score.audience desc nulls last
  ) else null end
 from public.contestants contestant left join averages avg_score on avg_score.contestant_id=contestant.id
 where contestant.campaign_id=p_campaign_id and (contestant.active or admin_view)
  and (p_round='elimination' or exists(select 1 from public.contest_round_entries entry
   where entry.campaign_id=p_campaign_id and entry.round=p_round and entry.contestant_id=contestant.id))
 order by avg_score.total desc nulls last,avg_score.voice desc nulls last,
  avg_score.stage desc nulls last,avg_score.audience desc nulls last,contestant.number;
end;
$$;
revoke all on function public.contest_judge_leaderboard(uuid,text) from public,anon,authenticated;
grant execute on function public.contest_judge_leaderboard(uuid,text) to anon,authenticated;

commit;
