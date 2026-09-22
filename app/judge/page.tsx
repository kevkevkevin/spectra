import {redirect} from 'next/navigation';
import AccountHeader from '@/components/account-header';
import JudgeRoster from '@/components/judge-roster';
import {requireCustomer} from '@/lib/customer';
import {UUID} from '@/lib/tickets';
import {isScoringRound,roundDetails,scoringRounds,type RoundSettings} from '@/lib/tabulation';
import '../tabulation.css';

export const dynamic='force-dynamic';
type Campaign={id:string;title:string;headline:string;active:boolean};
type Contestant={id:string;campaign_id:string;name:string;number:number;image_url:string;position:number};
type Card={campaign_id:string;contestant_id:string;round:string};
type RoundEntry={campaign_id:string;contestant_id:string;round:string};
type Params={campaign?:string;round?:string;error?:string;saved?:string};

export default async function JudgeDesk({searchParams}:{searchParams:Promise<Params>}){
 const {db,user}=await requireCustomer('/judge');
 const {data:judge,error:roleError}=await db.rpc('is_contest_judge');
 if(roleError||!judge)redirect('/account');
 const query=await searchParams;
 const [campaignResult,roundsResult,entriesResult,contestantResult,cardsResult]=await Promise.all([
  db.from('voting_campaigns').select('id,title,headline,active').eq('active',true).order('created_at',{ascending:false}),
  db.from('contest_scoring_rounds').select('campaign_id,round,scoring_open,results_visible,opened_at'),
  db.from('contest_round_entries').select('campaign_id,round,contestant_id'),
  db.from('contestants').select('id,campaign_id,name,number,image_url,position').eq('active',true).order('position').order('number'),
  db.from('contest_scorecards').select('campaign_id,contestant_id,round').eq('judge_id',user.id),
 ]);
 const campaigns=(campaignResult.data??[]) as Campaign[];
 const rounds=(roundsResult.data??[]) as RoundSettings[];
 const entries=(entriesResult.data??[]) as RoundEntry[];
 const contestants=(contestantResult.data??[]) as Contestant[];
 const scored=new Set(((cardsResult.data??[]) as Card[]).map(card=>`${card.campaign_id}:${card.round}:${card.contestant_id}`));
 const selected=campaigns.find(item=>item.id===query.campaign)||campaigns[0];
 const campaignRounds=rounds.filter(item=>item.campaign_id===selected?.id);
 const selectedRound=isScoringRound(query.round)?query.round:campaignRounds.find(item=>item.scoring_open)?.round??'elimination';
 const roundSettings=campaignRounds.find(item=>item.round===selectedRound);
 const eligible=new Set(entries.filter(item=>item.campaign_id===selected?.id&&item.round===selectedRound).map(item=>item.contestant_id));
 const setupError=campaignResult.error||roundsResult.error||entriesResult.error||contestantResult.error||cardsResult.error;
 const roster=contestants.filter(item=>item.campaign_id===selected?.id&&(selectedRound==='elimination'||eligible.has(item.id)));
 const done=roster.filter(item=>scored.has(`${selected?.id}:${selectedRound}:${item.id}`)).length;
 return <><AccountHeader/><main className="ticket-shell tabulation-shell">
  <p className="eyebrow">Judge desk</p><h1>Hear every voice.</h1>
  <p className="ticket-intro">Rate each contestant on all seven criteria. The final score is weighted across voice quality, stage presence, and audience impact.</p>
  {query.saved&&<p className="notice tabulation-success" role="status">Scorecard saved. The live admin leaderboard has been updated.</p>}
  {setupError&&<p className="notice" role="alert">Judge scoring needs database migration 008. Ask an admin to complete setup.</p>}
  {!setupError&&campaigns.length===0&&<p className="notice">There is no active contest campaign yet.</p>}
  {campaigns.length>1&&<nav className="tabulation-campaign-tabs" aria-label="Scoring campaigns">{campaigns.map(item=><a key={item.id} href={`/judge?campaign=${item.id}`} aria-current={selected?.id===item.id?'page':undefined}>{item.title}</a>)}</nav>}
  {selected&&<section className="ticket-panel tabulation-overview"><div><p className="eyebrow">{selected.headline||'Contest scoring'}</p><h2>{selected.title}</h2><p>{roundDetails[selectedRound].label}: {roundSettings?.scoring_open?'scoring is open. Submit or revise each scorecard.':roundSettings?.opened_at?'scoring is closed. Saved scorecards remain on record.':'waiting for the admin to open judging.'}</p></div><div className="tabulation-stat"><strong>{done} / {roster.length}</strong><span>Contenders scored · {roundDetails[selectedRound].shortLabel}</span></div></section>}
  {selected&&<nav className="tabulation-round-tabs" aria-label="Judging rounds">{scoringRounds.map(round=>{const state=campaignRounds.find(item=>item.round===round);return <a key={round} href={`/judge?campaign=${selected.id}&round=${round}`} aria-current={selectedRound===round?'page':undefined}><strong>{roundDetails[round].label}</strong><small>{state?.scoring_open?'Open':state?.opened_at?'Closed':'Not started'}</small></a>;})}</nav>}
  {selected&&roundSettings&&<JudgeRoster campaignId={selected.id} round={selectedRound} scoringOpen={roundSettings.scoring_open} contenders={roster.map(person=>({...person,scored:scored.has(`${selected.id}:${selectedRound}:${person.id}`)}))}/>}
 </main></>;
}
