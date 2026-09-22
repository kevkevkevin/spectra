import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ids={admin:'20000000-0000-4000-8000-000000000003',judge:'20000000-0000-4000-8000-000000000006',guest:'20000000-0000-4000-8000-000000000007'};
const campaign='30000000-0000-4000-8000-000000000001';
const first='31000000-0000-4000-8000-000000000001';
const second='31000000-0000-4000-8000-000000000002';

test('scoring rounds preserve elimination cards and isolate later rounds',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon nologin;
   create role authenticated nologin;
   create schema auth;
   grant usage on schema public,auth to anon,authenticated;
   create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
   $$;
   create table public.admins(user_id uuid primary key references auth.users(id));
   create function public.is_ticket_admin() returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.admins where user_id=(select auth.uid()))
   $$;
   create table public.voting_campaigns(id uuid primary key,active boolean not null default true);
   create table public.contestants(
    id uuid primary key,campaign_id uuid not null references public.voting_campaigns(id),
    number integer not null,name text not null,active boolean not null default true,
    unique(campaign_id,id)
   );
   insert into auth.users values
    ('${ids.admin}','admin@example.com',now()),
    ('${ids.judge}','judge@example.com',now()),
    ('${ids.guest}','guest@example.com',now());
   insert into public.admins values('${ids.admin}');
   insert into public.voting_campaigns(id) values('${campaign}');
   insert into public.contestants(id,campaign_id,number,name) values
    ('${first}','${campaign}',1,'First contender'),
    ('${second}','${campaign}',2,'Second contender');
  `);
  const asUser=(user,sql,params=[])=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[ids[user]]);
   return tx.query(sql,params);
  });
  const asAnon=(sql,params=[])=>db.transaction(async tx=>{
   await tx.exec('set local role anon');
   return tx.query(sql,params);
  });
  const migration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
  await db.exec(await migration('007_contest_tabulation.sql'));
  await asUser('admin','select public.set_contest_judge($1,true)',[ids.judge]);
  await asUser('admin',"update public.contest_scoring_settings set scoring_open=true where campaign_id=$1",[campaign]);
  const criteria=(await db.query('select id from public.contest_scoring_criteria order by position')).rows;
  const scores=rating=>JSON.stringify(criteria.map(item=>({criterion_id:item.id,score:rating})));
  const oldCard=(await asUser('judge','select public.submit_contest_scorecard($1,$2,$3::jsonb) as id',[campaign,first,scores(8)])).rows[0].id;

  await db.exec(await migration('008_contest_scoring_rounds.sql'));
  await db.exec(await migration('008_contest_scoring_rounds.sql'));
  assert.deepEqual((await db.query('select round,scoring_open from public.contest_scoring_rounds where campaign_id=$1 order by round',[campaign])).rows,
   [{round:'elimination',scoring_open:true},{round:'grand_final',scoring_open:false},{round:'semi_final',scoring_open:false}]);
  assert.deepEqual((await db.query('select id,round from public.contest_scorecards')).rows,[{id:oldCard,round:'elimination'}]);
  await assert.rejects(()=>asUser('judge','select public.submit_contest_scorecard($1,$2,$3,$4::jsonb)',[campaign,first,'semi_final',scores(9)]),/Scoring is closed/);
  await assert.rejects(()=>asUser('guest','select public.set_contest_round_state($1,$2,true,false)',[campaign,'semi_final']),/Admin access required/);
  await assert.rejects(()=>asUser('admin','select public.set_contest_round_state($1,$2,true,false)',[campaign,'semi_final']),/Close the current round/);

  await asUser('admin','select public.set_contest_round_state($1,$2,false,false)',[campaign,'elimination']);
  await assert.rejects(()=>asUser('admin','select public.set_contest_round_state($1,$2,true,false)',[campaign,'semi_final']),/Select advancing contenders/);
  await assert.rejects(()=>asUser('admin','select public.set_contest_round_entries($1,$2,$3::jsonb)',[campaign,'semi_final',JSON.stringify([second])]),/previous round/);
  await asUser('admin','select public.set_contest_round_entries($1,$2,$3::jsonb)',[campaign,'semi_final',JSON.stringify([first])]);
  await asUser('admin','select public.set_contest_round_state($1,$2,true,false)',[campaign,'semi_final']);
  await assert.rejects(()=>asUser('judge','select public.submit_contest_scorecard($1,$2,$3,$4::jsonb)',[campaign,second,'semi_final',scores(9)]),/has not advanced/);
  await assert.rejects(()=>asUser('admin','select public.set_contest_round_entries($1,$2,$3::jsonb)',[campaign,'semi_final',JSON.stringify([first,second])]),/locked/);
  const semiCard=(await asUser('judge','select public.submit_contest_scorecard($1,$2,$3,$4::jsonb) as id',[campaign,first,'semi_final',scores(9)])).rows[0].id;
  assert.notEqual(semiCard,oldCard);
  const elimination=(await asUser('admin','select * from public.contest_judge_leaderboard($1,$2)',[campaign,'elimination'])).rows;
  const semi=(await asUser('admin','select * from public.contest_judge_leaderboard($1,$2)',[campaign,'semi_final'])).rows;
  assert.equal(elimination.find(item=>item.contestant_id===first).total_points,'80.00');
  assert.equal(semi.find(item=>item.contestant_id===first).total_points,'90.00');
  assert.equal(semi.length,1);
  assert.equal((await asAnon('select * from public.contest_judge_leaderboard($1,$2)',[campaign,'semi_final'])).rows.length,0);
  await asUser('admin','select public.set_contest_round_state($1,$2,false,true)',[campaign,'semi_final']);
  assert.equal((await asAnon('select * from public.contest_judge_leaderboard($1,$2)',[campaign,'semi_final'])).rows.length,1);
  await asUser('admin','select public.set_contest_round_entries($1,$2,$3::jsonb)',[campaign,'grand_final',JSON.stringify([first])]);
  await asUser('admin','select public.set_contest_round_state($1,$2,true,false)',[campaign,'grand_final']);
  assert.equal((await db.query('select count(*) from public.contest_scorecards')).rows[0].count,2);
 }finally{await db.close();}
});
