import {redirect} from 'next/navigation';
import AccountHeader from '@/components/account-header';
import SubmitButton from '@/components/submit-button';
import TabulationLeaderboard from '@/components/tabulation-leaderboard';
import {requireAdmin} from '@/lib/admin';
import {categories,categoryDetails,isScoringRound,roundDetails,scoringRounds,type LeaderboardRow,type RoundSettings,type ScoringCriterion} from '@/lib/tabulation';
import {UUID} from '@/lib/tickets';
import {saveRoundEntries,saveRoundSettings,saveTabulationRubric,setJudgeAccess} from './actions';
import '../../tabulation.css';

export const dynamic='force-dynamic';
type Campaign={id:string;title:string;active:boolean};
type Judge={user_id:string};
type User={user_id:string;email:string|null;display_name:string|null;is_admin:boolean;confirmed:boolean};
type Contender={id:string;campaign_id:string;name:string;number:number;active:boolean};
type RoundEntry={campaign_id:string;round:string;contestant_id:string};
type Params={campaign?:string;round?:string;search?:string;saved?:string;error?:string};
const errors:Record<string,string>={
 invalid:'Select a valid campaign or user and try again.',
 setup:'Apply 008_contest_scoring_rounds.sql in Supabase, then reload.',
 rubric:'Use seven named criteria. Voice weights must total 50%, stage 30%, and audience impact 20%.',
 locked:'The rubric is locked because a judge has submitted a scorecard.',
 save:'The change could not be saved. Check the database setup and try again.',
 other_open:'Close the currently open round before opening another.',
 previous:'Close the previous round before opening this one.',
 entries:'Select at least one advancing contender before opening this round.',
 entries_locked:'Advancing contenders are locked after scoring opens.',
 unscored:'Only contenders scored in the previous round can advance.',
 inactive:'Activate this campaign before opening scoring.',
};

export default async function TabulationAdmin({searchParams}:{searchParams:Promise<Params>}){
 const {db,isAdmin}=await requireAdmin('/admin/tabulation');if(!isAdmin)redirect('/account');
 const query=await searchParams;
 const search=String(query.search??'').trim().slice(0,100);
 const [campaignResult,roundsResult,criteriaResult,entriesResult,contestantsResult,judgesResult,usersResult]=await Promise.all([
  db.from('voting_campaigns').select('id,title,active').order('created_at',{ascending:false}),
  db.from('contest_scoring_rounds').select('*'),
  db.from('contest_scoring_criteria').select('*').order('position'),
  db.from('contest_round_entries').select('campaign_id,round,contestant_id'),
  db.from('contestants').select('id,campaign_id,name,number,active').order('number'),
  db.from('contest_judges').select('user_id'),
  db.rpc('list_ticket_users',{p_search:search,p_limit:50}),
 ]);
 const campaigns=(campaignResult.data??[]) as Campaign[];
 const current=campaigns.find(item=>item.id===query.campaign)||campaigns[0];
 const rounds=(roundsResult.data??[]) as RoundSettings[];
 const campaignRounds=rounds.filter(item=>item.campaign_id===current?.id);
 const selectedRound=isScoringRound(query.round)?query.round:campaignRounds.find(item=>item.scoring_open)?.round??'elimination';
 const roundSettings=campaignRounds.find(item=>item.round===selectedRound);
 const [cardCount,allCardCount]=current?await Promise.all([
  db.from('contest_scorecards').select('id',{count:'exact',head:true}).eq('campaign_id',current.id).eq('round',selectedRound),
  db.from('contest_scorecards').select('id',{count:'exact',head:true}).eq('campaign_id',current.id),
 ]):[{count:0,error:null},{count:0,error:null}];
 const criteria=(criteriaResult.data??[]) as ScoringCriterion[];
 const entries=(entriesResult.data??[]) as RoundEntry[];
 const contenders=((contestantsResult.data??[]) as Contender[]).filter(item=>item.campaign_id===current?.id&&item.active);
 const judges=new Set(((judgesResult.data??[]) as Judge[]).map(item=>item.user_id));
 const users=(usersResult.data??[]) as User[];
 const setupMissing=[roundsResult.error,entriesResult.error,criteriaResult.error,judgesResult.error,cardCount.error,allCardCount.error].some(error=>error&&['42P01','42703','42883','PGRST202','PGRST205'].includes(error.code));
 const rubric=criteria.filter(item=>item.campaign_id===current?.id);
 const tally=current?await db.rpc('contest_judge_leaderboard',{p_campaign_id:current.id,p_round:selectedRound}):{data:[],error:null};
 const previousRound=selectedRound==='semi_final'?'elimination':selectedRound==='grand_final'?'semi_final':null;
 const priorTally=current&&previousRound?await db.rpc('contest_judge_leaderboard',{p_campaign_id:current.id,p_round:previousRound}):{data:[],error:null};
 const priorRows=(priorTally.data??[]) as LeaderboardRow[];
 const advanceable=priorRows.filter(item=>item.judge_count>0&&contenders.some(person=>person.id===item.contestant_id));
 const selectedEntries=new Set(entries.filter(item=>item.campaign_id===current?.id&&item.round===selectedRound).map(item=>item.contestant_id));
 const completed=cardCount.count??0;
 const rubricLocked=(allCardCount.count??0)>0;
 const entriesLocked=completed>0||Boolean(roundSettings?.scoring_open)||Boolean(roundSettings?.opened_at);
 const countByCategory=(category:ScoringCriterion['category'])=>rubric.filter(item=>item.category===category).reduce((sum,item)=>sum+item.weight,0);
 return <><AccountHeader/><main className="ticket-shell tabulation-shell">
  <nav className="admin-section-nav" aria-label="Contest administration"><a href="/admin/voting">Voting & contestants</a><a href="/contest/results" target="_blank" rel="noopener noreferrer">Public results ↗</a><a href="/judge">Judge desk</a></nav>
  <p className="eyebrow">Contest control room</p><h1>Tabulate the talent.</h1>
  <p className="ticket-intro">Assign judges, choose advancing contenders, and control Elimination, Semi-finals, and Grand Finals separately. Each round has its own 100-point results.</p>
  {query.saved&&<p className="notice tabulation-success" role="status">{query.saved==='rubric'?'Rubric saved.':query.saved==='settings'?'Round controls saved.':query.saved==='entries'?'Advancing contenders saved.':query.saved==='assigned'?'Judge access granted.':'Judge access removed.'}</p>}
  {query.error&&<p className="notice" role="alert">{errors[query.error]??errors.save}</p>}
  {setupMissing&&<p className="notice" role="alert">{errors.setup}</p>}
  {campaignResult.error&&<p className="notice" role="alert">Contest campaigns could not be loaded.</p>}
  {!setupMissing&&campaigns.length===0&&<p className="notice">Create a campaign and contestants in <a href="/admin/voting">Voting management</a> first.</p>}
  {campaigns.length>1&&<nav className="tabulation-campaign-tabs" aria-label="Tabulation campaigns">{campaigns.map(item=><a key={item.id} href={`/admin/tabulation?campaign=${item.id}`} aria-current={current?.id===item.id?'page':undefined}>{item.title}</a>)}</nav>}
  {current&&!setupMissing&&<><section className="ticket-panel tabulation-overview"><div><p className="eyebrow">{current.active?'Active campaign':'Inactive campaign'}</p><h2>{current.title}</h2><p>{roundDetails[selectedRound].label} scoring is {roundSettings?.scoring_open?'open':roundSettings?.opened_at?'closed':'not started'}. {roundSettings?.results_visible?'These round results are public.':'These round results are private to admins.'}</p></div><div className="tabulation-stat"><strong>{completed}</strong><span>{roundDetails[selectedRound].shortLabel} scorecards</span></div></section>
   <nav className="tabulation-round-tabs" aria-label="Scoring rounds">{scoringRounds.map(round=>{const state=campaignRounds.find(item=>item.round===round);return <a key={round} href={`/admin/tabulation?campaign=${current.id}&round=${round}`} aria-current={selectedRound===round?'page':undefined}><strong>{roundDetails[round].label}</strong><small>{state?.scoring_open?'Open':state?.opened_at?'Closed':'Not started'}</small></a>;})}</nav>
   <div className="tabulation-management-grid"><section className="ticket-panel"><p className="eyebrow">{roundDetails[selectedRound].label} controls</p><h2>Open the judging.</h2><form action={saveRoundSettings} className="tabulation-control-form"><input type="hidden" name="campaign_id" value={current.id}/><input type="hidden" name="round" value={selectedRound}/>
    <label className="tabulation-switch"><input type="checkbox" name="scoring_open" defaultChecked={roundSettings?.scoring_open??false}/><span><strong>Allow judges to score {roundDetails[selectedRound].label}</strong><small>Close the previous round and select advancing contenders before opening a later round.</small></span></label>
    <label className="tabulation-switch"><input type="checkbox" name="results_visible" defaultChecked={roundSettings?.results_visible??false}/><span><strong>Show {roundDetails[selectedRound].label} results publicly</strong><small>Admin results stay live even when public results are hidden.</small></span></label>
    <SubmitButton pending="Saving…">Save controls</SubmitButton>
   </form></section>
   <section className="ticket-panel"><p className="eyebrow">Computation</p><h2>100 points per round.</h2><dl className="tabulation-weight-summary">{categories.map(category=><div key={category}><dt>{categoryDetails[category].label}</dt><dd>{countByCategory(category)} / {categoryDetails[category].weight}%</dd></div>)}</dl><p className="tabulation-rule-note">Each judge submits a separate scorecard in each round. Subcriterion points = rating ÷ 10 × subweight; completed judge totals are averaged within that round. Scores do not carry over.</p></section></div>
   {previousRound&&<section className="ticket-panel tabulation-advancement"><div className="tabulation-section-heading"><div><p className="eyebrow">Advancing contenders</p><h2>Choose the next voices.</h2></div><span className="status-badge">{selectedEntries.size} selected</span></div><p>Choose contenders scored in {roundDetails[previousRound].label}. The list locks when {roundDetails[selectedRound].label} opens.</p>
    {priorTally.error&&<p className="notice" role="alert">Previous-round standings could not be loaded.</p>}
    {advanceable.length===0?<p className="notice">No contenders have a completed {roundDetails[previousRound].label} scorecard yet.</p>:<form action={saveRoundEntries}><input type="hidden" name="campaign_id" value={current.id}/><input type="hidden" name="round" value={selectedRound}/><div className="tabulation-advance-list">{advanceable.map(person=><label key={person.contestant_id} className="tabulation-advance-person"><input type="checkbox" name="contestant_id" value={person.contestant_id} defaultChecked={selectedEntries.has(person.contestant_id)} disabled={entriesLocked}/><span><strong>{String(person.number).padStart(2,'0')} · {person.name}</strong><small>{roundDetails[previousRound].shortLabel} · {person.total_points===null?'—':Number(person.total_points).toFixed(2)} / 100</small></span></label>)}</div><SubmitButton disabled={entriesLocked} pending="Saving contenders…">Save advancing contenders</SubmitButton></form>}
   </section>}
   <section className="ticket-panel tabulation-rubric"><div className="tabulation-section-heading"><div><p className="eyebrow">Editable rubric</p><h2>Seven ways to shine.</h2></div><span className="status-badge">{rubricLocked?'Locked after first score':'Editable before scoring'}</span></div>
    <p>Keep the category totals at 50%, 30%, and 20%. Rename each item and set its percentage before judges begin.</p>
    <form action={saveTabulationRubric}><input type="hidden" name="campaign_id" value={current.id}/>{categories.map(category=><fieldset className="tabulation-rubric-group" key={category}><legend>{categoryDetails[category].label} · {categoryDetails[category].weight}%</legend>{rubric.filter(item=>item.category===category).map(item=><div className="tabulation-rubric-row" key={item.id}><input type="hidden" name="criterion_id" value={item.id}/><label>Subcriterion<input name={`name_${item.id}`} defaultValue={item.name} required maxLength={100} disabled={rubricLocked}/></label><label>Weight %<input type="number" name={`weight_${item.id}`} defaultValue={item.weight} min={1} max={50} step={1} required disabled={rubricLocked}/></label></div>)}</fieldset>)}<SubmitButton disabled={rubricLocked||rubric.length!==7} pending="Saving rubric…">Save rubric</SubmitButton></form>
   </section>
   <section className="ticket-panel tabulation-leaderboard-panel"><TabulationLeaderboard campaignId={current.id} round={selectedRound} initialRows={(tally.data??[]) as LeaderboardRow[]}/>{tally.error&&<p className="notice" role="alert">The live leaderboard could not be loaded. Check migration 008.</p>}</section>
  </>}
  {!setupMissing&&<section className="ticket-panel tabulation-judges"><div className="tabulation-section-heading"><div><p className="eyebrow">Judge accounts</p><h2>Your scoring panel.</h2></div><span className="status-badge">{judges.size} assigned</span></div><p>Judges sign up normally. Assign their accounts here; they will see a Judge desk link after signing in.</p>
   <form method="get" action="/admin/tabulation" className="staff-search"><label>Find a user<input type="search" name="search" defaultValue={search} maxLength={100} placeholder="Search by name or email"/></label><button className="button" type="submit">Search</button>{search&&<a className="text-link" href="/admin/tabulation">Clear</a>}</form>
   {usersResult.error?<p className="notice" role="alert">The user directory could not be loaded. Apply migration 004 first.</p>:<ul className="staff-user-list">{users.map(person=><li className="staff-user-row" key={person.user_id}><div className="staff-user-identity"><h3>{person.display_name||person.email||'Registered user'}</h3><p>{person.email}</p>{!person.confirmed&&<small>Email confirmation pending</small>}</div><div className="staff-user-access"><span className={`status-badge ${judges.has(person.user_id)?'approved':''}`}>{judges.has(person.user_id)?'Judge':'Not assigned'}</span><form action={setJudgeAccess}><input type="hidden" name="user_id" value={person.user_id}/><input type="hidden" name="judge" value={judges.has(person.user_id)?'false':'true'}/><input type="hidden" name="search" value={search}/><SubmitButton pending="Updating…">{judges.has(person.user_id)?'Remove judge':'Make judge'}</SubmitButton></form></div></li>)}</ul>}
  </section>}
 </main></>;
}
