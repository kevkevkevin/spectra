-- Admin-selected rosters for every judging round, including Elimination.
-- Run after 008. Existing Elimination campaigns inherit all active contestants.
begin;

alter table public.contest_round_entries drop constraint if exists contest_round_entries_round_check;
alter table public.contest_round_entries add constraint contest_round_entries_round_check
 check(round in ('elimination','semi_final','grand_final'));

-- Preserve the pre-009 behavior until an admin edits the Elimination roster.
-- NULL exists only for round rows present when 009 is first applied. New rows
-- default to initialized so reruns never repopulate a roster the admin cleared.
alter table public.contest_scoring_rounds add column if not exists roster_initialized boolean;
insert into public.contest_round_entries(campaign_id,round,contestant_id)
select contestant.campaign_id,'elimination',contestant.id
from public.contestants contestant
join public.contest_scoring_rounds round_state on round_state.campaign_id=contestant.campaign_id
 and round_state.round='elimination'
where contestant.active and round_state.roster_initialized is null
on conflict do nothing;
update public.contest_scoring_rounds set roster_initialized=true where roster_initialized is null;
alter table public.contest_scoring_rounds alter column roster_initialized set default true;
alter table public.contest_scoring_rounds alter column roster_initialized set not null;

create or replace function public.set_contest_round_entries(p_campaign_id uuid,p_round text,p_contestants jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare contestant uuid;
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_round is null or p_round not in ('elimination','semi_final','grand_final') or p_contestants is null
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
  if not exists(select 1 from public.contest_round_entries where campaign_id=p_campaign_id and round=p_round) then
   raise exception 'Select round contestants first';
  end if;
  if p_round<>'elimination' then
   previous_round:=case p_round when 'semi_final' then 'elimination' else 'semi_final' end;
   if not exists(select 1 from public.contest_scoring_rounds where campaign_id=p_campaign_id and round=previous_round
    and opened_at is not null and not scoring_open) then raise exception 'Close the previous round first'; end if;
  end if;
 end if;
 update public.contest_scoring_rounds set scoring_open=p_scoring_open,results_visible=p_results_visible,
  opened_at=case when p_scoring_open then coalesce(opened_at,now()) else opened_at end
 where campaign_id=p_campaign_id and round=p_round;
end;
$$;
revoke all on function public.set_contest_round_state(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.set_contest_round_state(uuid,text,boolean,boolean) to authenticated;

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
 if not exists(select 1 from public.contest_round_entries where campaign_id=p_campaign_id and round=p_round
  and contestant_id=p_contestant_id) then raise exception 'Contestant is not in this round'; end if;
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

create or replace function public.contest_judge_leaderboard(p_campaign_id uuid,p_round text)
returns table(contestant_id uuid,number integer,name text,judge_count integer,
 voice_points numeric,stage_points numeric,audience_points numeric,total_points numeric,rank_position bigint)
language plpgsql stable security definer set search_path='' as $$
declare admin_view boolean:=public.is_ticket_admin(); judge_view boolean:=public.is_contest_judge();
begin
 if p_round not in ('elimination','semi_final','grand_final') then return; end if;
 if not admin_view and not judge_view and not exists(
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
 from public.contest_round_entries entry
 join public.contestants contestant on contestant.campaign_id=entry.campaign_id and contestant.id=entry.contestant_id
 left join averages avg_score on avg_score.contestant_id=contestant.id
 where entry.campaign_id=p_campaign_id and entry.round=p_round and (contestant.active or admin_view)
 order by avg_score.total desc nulls last,avg_score.voice desc nulls last,
  avg_score.stage desc nulls last,avg_score.audience desc nulls last,contestant.number;
end;
$$;
revoke all on function public.contest_judge_leaderboard(uuid,text) from public,anon,authenticated;
grant execute on function public.contest_judge_leaderboard(uuid,text) to anon,authenticated;

commit;
