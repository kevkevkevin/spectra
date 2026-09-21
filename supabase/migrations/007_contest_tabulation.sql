-- Judge tabulation for each voting campaign. Run after 006. Safe to rerun.
begin;

create table if not exists public.contest_judges (
 user_id uuid primary key references auth.users(id) on delete cascade,
 assigned_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists public.contest_scoring_settings (
 campaign_id uuid primary key references public.voting_campaigns(id) on delete cascade,
 scoring_open boolean not null default false,
 results_visible boolean not null default false
);
create table if not exists public.contest_scoring_criteria (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.voting_campaigns(id) on delete cascade,
 category text not null check(category in ('voice','stage','audience')),
 name text not null check(length(trim(name)) between 1 and 100),
 weight integer not null check(weight between 1 and 50),
 position integer not null check(position between 1 and 7),
 unique(campaign_id,position),
 unique(campaign_id,id)
);
create table if not exists public.contest_scorecards (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.voting_campaigns(id) on delete cascade,
 contestant_id uuid not null,
 judge_id uuid not null references auth.users(id) on delete restrict,
 submitted_at timestamptz not null default now(),
 foreign key(campaign_id,contestant_id) references public.contestants(campaign_id,id) on delete restrict,
 unique(campaign_id,contestant_id,judge_id),
 unique(id,campaign_id)
);
create table if not exists public.contest_scores (
 scorecard_id uuid not null references public.contest_scorecards(id) on delete cascade,
 campaign_id uuid not null,
 criterion_id uuid not null,
 score numeric(4,2) not null check(score between 0 and 10),
 primary key(scorecard_id,criterion_id),
 foreign key(scorecard_id,campaign_id) references public.contest_scorecards(id,campaign_id) on delete cascade,
 foreign key(campaign_id,criterion_id) references public.contest_scoring_criteria(campaign_id,id) on delete restrict
);
create index if not exists contest_scorecards_campaign_contestant on public.contest_scorecards(campaign_id,contestant_id);

-- New campaigns receive seven editable criteria. Existing campaigns are seeded below.
create or replace function public.seed_contest_scoring() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.contest_scoring_settings(campaign_id) values(new.id) on conflict do nothing;
 insert into public.contest_scoring_criteria(campaign_id,category,name,weight,position)
 select new.id,v.category,v.name,v.weight,v.position from (values
  ('voice','Vocal technique',20,1),('voice','Pitch and control',15,2),('voice','Tone and expression',15,3),
  ('stage','Confidence and charisma',15,4),('stage','Movement and presentation',15,5),
  ('audience','Emotional connection',10,6),('audience','Audience engagement',10,7)
 ) as v(category,name,weight,position)
 where not exists(select 1 from public.contest_scoring_criteria c where c.campaign_id=new.id);
 return new;
end;
$$;
drop trigger if exists seed_contest_scoring on public.voting_campaigns;
create trigger seed_contest_scoring after insert on public.voting_campaigns
for each row execute function public.seed_contest_scoring();
insert into public.contest_scoring_settings(campaign_id)
select id from public.voting_campaigns on conflict do nothing;
insert into public.contest_scoring_criteria(campaign_id,category,name,weight,position)
select campaign.id,v.category,v.name,v.weight,v.position
from public.voting_campaigns campaign cross join (values
 ('voice','Vocal technique',20,1),('voice','Pitch and control',15,2),('voice','Tone and expression',15,3),
 ('stage','Confidence and charisma',15,4),('stage','Movement and presentation',15,5),
 ('audience','Emotional connection',10,6),('audience','Audience engagement',10,7)
) as v(category,name,weight,position)
where not exists(select 1 from public.contest_scoring_criteria c where c.campaign_id=campaign.id);

alter table public.contest_judges enable row level security;
alter table public.contest_scoring_settings enable row level security;
alter table public.contest_scoring_criteria enable row level security;
alter table public.contest_scorecards enable row level security;
alter table public.contest_scores enable row level security;
revoke all on public.contest_judges,public.contest_scoring_settings,public.contest_scoring_criteria,public.contest_scorecards,public.contest_scores from anon,authenticated;
grant select on public.contest_scoring_settings,public.contest_scoring_criteria to anon,authenticated;
grant update(scoring_open,results_visible) on public.contest_scoring_settings to authenticated;
grant select on public.contest_judges,public.contest_scorecards,public.contest_scores to authenticated;
drop policy if exists "Read own judge role or admin" on public.contest_judges;
create policy "Read own judge role or admin" on public.contest_judges for select to authenticated
using(user_id=(select auth.uid()) or public.is_ticket_admin());
drop policy if exists "Read scoring settings" on public.contest_scoring_settings;
create policy "Read scoring settings" on public.contest_scoring_settings for select using(true);
drop policy if exists "Admins update scoring settings" on public.contest_scoring_settings;
create policy "Admins update scoring settings" on public.contest_scoring_settings for update to authenticated
using(public.is_ticket_admin()) with check(public.is_ticket_admin());
drop policy if exists "Read scoring criteria" on public.contest_scoring_criteria;
create policy "Read scoring criteria" on public.contest_scoring_criteria for select using(true);
drop policy if exists "Read own scorecards or admin" on public.contest_scorecards;
create policy "Read own scorecards or admin" on public.contest_scorecards for select to authenticated
using(judge_id=(select auth.uid()) or public.is_ticket_admin());
drop policy if exists "Read own scores or admin" on public.contest_scores;
create policy "Read own scores or admin" on public.contest_scores for select to authenticated
using(exists(select 1 from public.contest_scorecards card where card.id=scorecard_id and
 (card.judge_id=(select auth.uid()) or public.is_ticket_admin())));

create or replace function public.is_contest_judge() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.contest_judges j where j.user_id=(select auth.uid()));
$$;
revoke all on function public.is_contest_judge() from public,anon;
grant execute on function public.is_contest_judge() to authenticated;

create or replace function public.set_contest_judge(p_user_id uuid,p_judge boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_user_id is null or p_judge is null then raise exception 'Invalid judge assignment'; end if;
 if not exists(select 1 from auth.users u where u.id=p_user_id) then raise exception 'User not found'; end if;
 if p_judge then
  insert into public.contest_judges(user_id,assigned_by) values(p_user_id,auth.uid()) on conflict do nothing;
 else
  delete from public.contest_judges where user_id=p_user_id;
 end if;
end;
$$;
revoke all on function public.set_contest_judge(uuid,boolean) from public,anon;
grant execute on function public.set_contest_judge(uuid,boolean) to authenticated;

-- The seven slots stay fixed. Admins may edit their labels and weights only before scoring starts.
create or replace function public.save_contest_rubric(p_campaign_id uuid,p_criteria jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare entry jsonb; criterion_id uuid; title text; points integer; seen uuid[]:='{}'; category_sums integer[];
begin
 if not public.is_ticket_admin() then raise exception 'Admin access required'; end if;
 if p_campaign_id is null or jsonb_typeof(p_criteria)<>'array' or jsonb_array_length(p_criteria)<>7 then raise exception 'Seven criteria are required'; end if;
 perform 1 from public.contest_scoring_settings where campaign_id=p_campaign_id for update;
 if not found then raise exception 'Campaign not found'; end if;
 if exists(select 1 from public.contest_scorecards where campaign_id=p_campaign_id) then raise exception 'Rubric is locked after the first scorecard'; end if;
 for entry in select item from jsonb_array_elements(p_criteria) as rubric(item) loop
  if jsonb_typeof(entry->'id')<>'string' or jsonb_typeof(entry->'name')<>'string' or jsonb_typeof(entry->'weight')<>'number' then raise exception 'Invalid criterion'; end if;
  criterion_id:=(entry->>'id')::uuid; title:=trim(entry->>'name');
  if (entry->>'weight') !~ '^[0-9]+$' then raise exception 'Weights must be whole percentages'; end if;
  points:=(entry->>'weight')::integer;
  if criterion_id=any(seen) or length(title) not between 1 and 100 or points not between 1 and 50 then raise exception 'Invalid criterion'; end if;
  update public.contest_scoring_criteria set name=title,weight=points where campaign_id=p_campaign_id and id=criterion_id;
  if not found then raise exception 'Criterion does not belong to campaign'; end if;
  seen:=array_append(seen,criterion_id);
 end loop;
 select array[
  coalesce(sum(weight) filter(where category='voice'),0)::integer,
  coalesce(sum(weight) filter(where category='stage'),0)::integer,
  coalesce(sum(weight) filter(where category='audience'),0)::integer
 ] into category_sums from public.contest_scoring_criteria where campaign_id=p_campaign_id;
 if category_sums<>array[50,30,20] then raise exception 'Category weights must total 50, 30, and 20 percent'; end if;
end;
$$;
revoke all on function public.save_contest_rubric(uuid,jsonb) from public,anon;
grant execute on function public.save_contest_rubric(uuid,jsonb) to authenticated;

create or replace function public.submit_contest_scorecard(p_campaign_id uuid,p_contestant_id uuid,p_scores jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare entry jsonb; criterion_id uuid; value numeric(4,2); seen uuid[]:='{}'; card_id uuid;
begin
 if not public.is_contest_judge() then raise exception 'Judge access required'; end if;
 if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then raise exception 'Confirm your email first'; end if;
 if p_campaign_id is null or p_contestant_id is null or jsonb_typeof(p_scores)<>'array' or jsonb_array_length(p_scores)<>7 then raise exception 'Score every criterion'; end if;
 perform 1 from public.contest_scoring_settings where campaign_id=p_campaign_id and scoring_open for share;
 if not found then raise exception 'Scoring is closed'; end if;
 if not exists(select 1 from public.contestants where id=p_contestant_id and campaign_id=p_campaign_id and active) then raise exception 'Contestant is unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_campaign_id::text||p_contestant_id::text,0));
 for entry in select item from jsonb_array_elements(p_scores) as ballot(item) loop
  if jsonb_typeof(entry->'criterion_id')<>'string' or jsonb_typeof(entry->'score')<>'number' then raise exception 'Invalid score'; end if;
  criterion_id:=(entry->>'criterion_id')::uuid;
  if (entry->>'score') !~ '^(10([.]0{1,2})?|[0-9]([.][0-9]{1,2})?)$' then raise exception 'Scores must be from 0 to 10 with up to two decimals'; end if;
  value:=(entry->>'score')::numeric;
  if criterion_id=any(seen) or not exists(select 1 from public.contest_scoring_criteria where campaign_id=p_campaign_id and id=criterion_id) then raise exception 'Invalid criterion'; end if;
  seen:=array_append(seen,criterion_id);
 end loop;
 if (select count(*) from public.contest_scoring_criteria where campaign_id=p_campaign_id)<>7 then raise exception 'Rubric is incomplete'; end if;
 insert into public.contest_scorecards(campaign_id,contestant_id,judge_id)
 values(p_campaign_id,p_contestant_id,auth.uid())
 on conflict(campaign_id,contestant_id,judge_id) do update set submitted_at=now()
 returning id into card_id;
 delete from public.contest_scores where scorecard_id=card_id;
 insert into public.contest_scores(scorecard_id,campaign_id,criterion_id,score)
 select card_id,p_campaign_id,(item->>'criterion_id')::uuid,(item->>'score')::numeric
 from jsonb_array_elements(p_scores) as ballot(item);
 return card_id;
end;
$$;
revoke all on function public.submit_contest_scorecard(uuid,uuid,jsonb) from public,anon;
grant execute on function public.submit_contest_scorecard(uuid,uuid,jsonb) to authenticated;

-- A completed judge card contributes at most 100 points. Each contestant's
-- category and overall totals are the average of submitted judge cards.
create or replace function public.contest_judge_leaderboard(p_campaign_id uuid)
returns table(contestant_id uuid,number integer,name text,judge_count integer,
 voice_points numeric,stage_points numeric,audience_points numeric,total_points numeric,rank_position bigint)
language plpgsql stable security definer set search_path='' as $$
declare admin_view boolean:=public.is_ticket_admin();
begin
 if not admin_view and not exists(
  select 1 from public.contest_scoring_settings s join public.voting_campaigns campaign on campaign.id=s.campaign_id
  where s.campaign_id=p_campaign_id and s.results_visible and campaign.active
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
  where card.campaign_id=p_campaign_id
  group by card.contestant_id,card.id
  having count(*)=7
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
 order by avg_score.total desc nulls last,avg_score.voice desc nulls last,
  avg_score.stage desc nulls last,avg_score.audience desc nulls last,contestant.number;
end;
$$;
revoke all on function public.contest_judge_leaderboard(uuid) from public,anon,authenticated;
grant execute on function public.contest_judge_leaderboard(uuid) to anon,authenticated;

commit;
