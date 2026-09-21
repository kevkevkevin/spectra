import {redirect} from 'next/navigation';
import AccountHeader from '@/components/account-header';
import {requireCustomer} from '@/lib/customer';
import {UUID} from '@/lib/tickets';
import '../tabulation.css';

export const dynamic='force-dynamic';
type Campaign={id:string;title:string;headline:string;active:boolean};
type Contestant={id:string;campaign_id:string;name:string;number:number;image_url:string;position:number};
type Card={campaign_id:string;contestant_id:string};
type Params={campaign?:string;error?:string;saved?:string};

export default async function JudgeDesk({searchParams}:{searchParams:Promise<Params>}){
 const {db,user}=await requireCustomer('/judge');
 const {data:judge,error:roleError}=await db.rpc('is_contest_judge');
 if(roleError||!judge)redirect('/account');
 const query=await searchParams;
 const [campaignResult,settingsResult,contestantResult,cardsResult]=await Promise.all([
  db.from('voting_campaigns').select('id,title,headline,active').eq('active',true).order('created_at',{ascending:false}),
  db.from('contest_scoring_settings').select('campaign_id,scoring_open'),
  db.from('contestants').select('id,campaign_id,name,number,image_url,position').eq('active',true).order('position').order('number'),
  db.from('contest_scorecards').select('campaign_id,contestant_id').eq('judge_id',user.id),
 ]);
 const campaigns=(campaignResult.data??[]) as Campaign[];
 const settings=new Map((settingsResult.data??[]).map(item=>[item.campaign_id,Boolean(item.scoring_open)]));
 const contestants=(contestantResult.data??[]) as Contestant[];
 const scored=new Set(((cardsResult.data??[]) as Card[]).map(card=>`${card.campaign_id}:${card.contestant_id}`));
 const selected=campaigns.find(item=>item.id===query.campaign)||campaigns[0];
 const setupError=campaignResult.error||settingsResult.error||contestantResult.error||cardsResult.error;
 const roster=contestants.filter(item=>item.campaign_id===selected?.id);
 const done=roster.filter(item=>scored.has(`${selected?.id}:${item.id}`)).length;
 return <><AccountHeader/><main className="ticket-shell tabulation-shell">
  <p className="eyebrow">Judge desk</p><h1>Hear every voice.</h1>
  <p className="ticket-intro">Rate each contestant on all seven criteria. The final score is weighted across voice quality, stage presence, and audience impact.</p>
  {query.saved&&<p className="notice tabulation-success" role="status">Scorecard saved. The live admin leaderboard has been updated.</p>}
  {setupError&&<p className="notice" role="alert">Judge scoring needs database migration 007. Ask an admin to complete setup.</p>}
  {!setupError&&campaigns.length===0&&<p className="notice">There is no active contest campaign yet.</p>}
  {campaigns.length>1&&<nav className="tabulation-campaign-tabs" aria-label="Scoring campaigns">{campaigns.map(item=><a key={item.id} href={`/judge?campaign=${item.id}`} aria-current={selected?.id===item.id?'page':undefined}>{item.title}</a>)}</nav>}
  {selected&&<section className="ticket-panel tabulation-overview"><div><p className="eyebrow">{selected.headline||'Contest scoring'}</p><h2>{selected.title}</h2><p>{settings.get(selected.id)?'Scoring is open. You can submit or revise each scorecard.':'Scoring is closed. Saved scorecards remain on record.'}</p></div><div className="tabulation-stat"><strong>{done} / {roster.length}</strong><span>Contestants scored</span></div></section>}
  {selected&&<div className="judge-roster">{roster.map(person=><article className="judge-person" key={person.id}>
   {person.image_url?<img src={person.image_url} alt="" loading="lazy"/>:<span className="judge-person-placeholder">{String(person.number).padStart(2,'0')}</span>}
   <div><small>Contestant {String(person.number).padStart(2,'0')}</small><h3>{person.name}</h3><span className={scored.has(`${selected.id}:${person.id}`)?'judge-done':'judge-pending'}>{scored.has(`${selected.id}:${person.id}`)?'Scorecard submitted':'Awaiting your score'}</span></div>
   {settings.get(selected.id)&&<a className="button" href={`/judge/${selected.id}/${person.id}`}>{scored.has(`${selected.id}:${person.id}`)?'Edit score':'Score now'} ↗</a>}
  </article>)}</div>}
 </main></>;
}
