import {redirect} from 'next/navigation';
import AccountHeader from '@/components/account-header';
import SubmitButton from '@/components/submit-button';
import TabulationLeaderboard from '@/components/tabulation-leaderboard';
import {requireAdmin} from '@/lib/admin';
import {categories,categoryDetails,type LeaderboardRow,type ScoringCriterion,type ScoringSettings} from '@/lib/tabulation';
import {UUID} from '@/lib/tickets';
import {saveTabulationRubric,saveTabulationSettings,setJudgeAccess} from './actions';
import '../../tabulation.css';

export const dynamic='force-dynamic';
type Campaign={id:string;title:string;active:boolean};
type Judge={user_id:string};
type User={user_id:string;email:string|null;display_name:string|null;is_admin:boolean;confirmed:boolean};
type Params={campaign?:string;search?:string;saved?:string;error?:string};
const errors:Record<string,string>={
 invalid:'Select a valid campaign or user and try again.',
 setup:'Apply 007_contest_tabulation.sql in Supabase, then reload.',
 rubric:'Use seven named criteria. Voice weights must total 50%, stage 30%, and audience impact 20%.',
 locked:'The rubric is locked because a judge has submitted a scorecard.',
 save:'The change could not be saved. Check the database setup and try again.',
};

export default async function TabulationAdmin({searchParams}:{searchParams:Promise<Params>}){
 const {db,isAdmin}=await requireAdmin('/admin/tabulation');if(!isAdmin)redirect('/account');
 const query=await searchParams;
 const search=String(query.search??'').trim().slice(0,100);
 const [campaignResult,settingsResult,criteriaResult,judgesResult,usersResult]=await Promise.all([
  db.from('voting_campaigns').select('id,title,active').order('created_at',{ascending:false}),
  db.from('contest_scoring_settings').select('*'),
  db.from('contest_scoring_criteria').select('*').order('position'),
  db.from('contest_judges').select('user_id'),
  db.rpc('list_ticket_users',{p_search:search,p_limit:50}),
 ]);
 const campaigns=(campaignResult.data??[]) as Campaign[];
 const current=campaigns.find(item=>item.id===query.campaign)||campaigns[0];
 const cardCount=current?await db.from('contest_scorecards').select('id',{count:'exact',head:true}).eq('campaign_id',current.id):{count:0,error:null};
 const settings=(settingsResult.data??[]) as ScoringSettings[];
 const criteria=(criteriaResult.data??[]) as ScoringCriterion[];
 const judges=new Set(((judgesResult.data??[]) as Judge[]).map(item=>item.user_id));
 const users=(usersResult.data??[]) as User[];
 const setupMissing=[settingsResult.error,criteriaResult.error,judgesResult.error,cardCount.error].some(error=>error&&['42P01','42703','42883','PGRST202','PGRST205'].includes(error.code));
 const settingsForCurrent=settings.find(item=>item.campaign_id===current?.id);
 const rubric=criteria.filter(item=>item.campaign_id===current?.id);
 const tally=current?await db.rpc('contest_judge_leaderboard',{p_campaign_id:current.id}):{data:[],error:null};
 const completed=cardCount.count??0;
 const countByCategory=(category:ScoringCriterion['category'])=>rubric.filter(item=>item.category===category).reduce((sum,item)=>sum+item.weight,0);
 return <><AccountHeader/><main className="ticket-shell tabulation-shell">
  <nav className="admin-section-nav" aria-label="Contest administration"><a href="/admin/voting">Voting & contestants</a><a href="/contest/results" target="_blank" rel="noopener noreferrer">Public results ↗</a><a href="/judge">Judge desk</a></nav>
  <p className="eyebrow">Contest control room</p><h1>Tabulate the talent.</h1>
  <p className="ticket-intro">Assign judges, set seven subcriteria, and follow weighted results as scorecards arrive. Judge scores are separate from ticket-backed audience votes.</p>
  {query.saved&&<p className="notice tabulation-success" role="status">{query.saved==='rubric'?'Rubric saved.':query.saved==='settings'?'Scoring controls saved.':query.saved==='assigned'?'Judge access granted.':'Judge access removed.'}</p>}
  {query.error&&<p className="notice" role="alert">{errors[query.error]??errors.save}</p>}
  {setupMissing&&<p className="notice" role="alert">{errors.setup}</p>}
  {campaignResult.error&&<p className="notice" role="alert">Contest campaigns could not be loaded.</p>}
  {!setupMissing&&campaigns.length===0&&<p className="notice">Create a campaign and contestants in <a href="/admin/voting">Voting management</a> first.</p>}
  {campaigns.length>1&&<nav className="tabulation-campaign-tabs" aria-label="Tabulation campaigns">{campaigns.map(item=><a key={item.id} href={`/admin/tabulation?campaign=${item.id}`} aria-current={current?.id===item.id?'page':undefined}>{item.title}</a>)}</nav>}
  {current&&!setupMissing&&<><section className="ticket-panel tabulation-overview"><div><p className="eyebrow">{current.active?'Active campaign':'Inactive campaign'}</p><h2>{current.title}</h2><p>Scoring is {settingsForCurrent?.scoring_open?'open':'closed'}. {settingsForCurrent?.results_visible?'Judge results are visible to the public.':'Judge results are private to admins.'}</p></div><div className="tabulation-stat"><strong>{completed}</strong><span>Scorecards submitted</span></div></section>
   <div className="tabulation-management-grid"><section className="ticket-panel"><p className="eyebrow">Scoring controls</p><h2>Open the judging.</h2><form action={saveTabulationSettings} className="tabulation-control-form"><input type="hidden" name="campaign_id" value={current.id}/>
    <label className="tabulation-switch"><input type="checkbox" name="scoring_open" defaultChecked={settingsForCurrent?.scoring_open??false}/><span><strong>Allow judges to score</strong><small>Judges can submit or revise complete scorecards while this is on.</small></span></label>
    <label className="tabulation-switch"><input type="checkbox" name="results_visible" defaultChecked={settingsForCurrent?.results_visible??false}/><span><strong>Show judge results publicly</strong><small>Admin results stay live even when public results are hidden.</small></span></label>
    <SubmitButton pending="Saving…">Save controls</SubmitButton>
   </form></section>
   <section className="ticket-panel"><p className="eyebrow">Computation</p><h2>100-point score.</h2><dl className="tabulation-weight-summary">{categories.map(category=><div key={category}><dt>{categoryDetails[category].label}</dt><dd>{countByCategory(category)} / {categoryDetails[category].weight}%</dd></div>)}</dl><p className="tabulation-rule-note">Each subcriterion is rated 0–10. Its weighted contribution is rating ÷ 10 × subweight. Judge totals are averaged for each contestant.</p></section></div>
   <section className="ticket-panel tabulation-rubric"><div className="tabulation-section-heading"><div><p className="eyebrow">Editable rubric</p><h2>Seven ways to shine.</h2></div><span className="status-badge">{completed?'Locked after first score':'Editable before scoring'}</span></div>
    <p>Keep the category totals at 50%, 30%, and 20%. Rename each item and set its percentage before judges begin.</p>
    <form action={saveTabulationRubric}><input type="hidden" name="campaign_id" value={current.id}/>{categories.map(category=><fieldset className="tabulation-rubric-group" key={category}><legend>{categoryDetails[category].label} · {categoryDetails[category].weight}%</legend>{rubric.filter(item=>item.category===category).map(item=><div className="tabulation-rubric-row" key={item.id}><input type="hidden" name="criterion_id" value={item.id}/><label>Subcriterion<input name={`name_${item.id}`} defaultValue={item.name} required maxLength={100} disabled={completed>0}/></label><label>Weight %<input type="number" name={`weight_${item.id}`} defaultValue={item.weight} min={1} max={50} step={1} required disabled={completed>0}/></label></div>)}</fieldset>)}<SubmitButton disabled={completed>0||rubric.length!==7} pending="Saving rubric…">Save rubric</SubmitButton></form>
   </section>
   <section className="ticket-panel tabulation-leaderboard-panel"><TabulationLeaderboard campaignId={current.id} initialRows={(tally.data??[]) as LeaderboardRow[]}/>{tally.error&&<p className="notice" role="alert">The live leaderboard could not be loaded. Check migration 007.</p>}</section>
  </>}
  {!setupMissing&&<section className="ticket-panel tabulation-judges"><div className="tabulation-section-heading"><div><p className="eyebrow">Judge accounts</p><h2>Your scoring panel.</h2></div><span className="status-badge">{judges.size} assigned</span></div><p>Judges sign up normally. Assign their accounts here; they will see a Judge desk link after signing in.</p>
   <form method="get" action="/admin/tabulation" className="staff-search"><label>Find a user<input type="search" name="search" defaultValue={search} maxLength={100} placeholder="Search by name or email"/></label><button className="button" type="submit">Search</button>{search&&<a className="text-link" href="/admin/tabulation">Clear</a>}</form>
   {usersResult.error?<p className="notice" role="alert">The user directory could not be loaded. Apply migration 004 first.</p>:<ul className="staff-user-list">{users.map(person=><li className="staff-user-row" key={person.user_id}><div className="staff-user-identity"><h3>{person.display_name||person.email||'Registered user'}</h3><p>{person.email}</p>{!person.confirmed&&<small>Email confirmation pending</small>}</div><div className="staff-user-access"><span className={`status-badge ${judges.has(person.user_id)?'approved':''}`}>{judges.has(person.user_id)?'Judge':'Not assigned'}</span><form action={setJudgeAccess}><input type="hidden" name="user_id" value={person.user_id}/><input type="hidden" name="judge" value={judges.has(person.user_id)?'false':'true'}/><input type="hidden" name="search" value={search}/><SubmitButton pending="Updating…">{judges.has(person.user_id)?'Remove judge':'Make judge'}</SubmitButton></form></div></li>)}</ul>}
  </section>}
 </main></>;
}
