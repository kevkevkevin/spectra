import {notFound,redirect} from 'next/navigation';
import AccountHeader from '@/components/account-header';
import JudgeScoreForm from '@/components/judge-score-form';
import {requireCustomer} from '@/lib/customer';
import {UUID} from '@/lib/tickets';
import {isScoringRound,roundDetails,type ScoringCriterion} from '@/lib/tabulation';
import '../../../tabulation.css';

export const dynamic='force-dynamic';
type Params={campaignId:string;contestantId:string};
type Query={error?:string;round?:string};
const messages:Record<string,string>={
 score:'Give every criterion a score from 0 to 10, with up to two decimal places.',
 closed:'Scoring has closed. Ask an admin before making further changes.',
 setup:'The scoring rubric is incomplete. Ask an admin to complete setup.',
 save:'The scorecard could not be saved. Refresh and try again.',
};

export default async function ScoreContestant({params,searchParams}:{params:Promise<Params>;searchParams:Promise<Query>}){
 const {campaignId,contestantId}=await params;const query=await searchParams;
 const round=isScoringRound(query.round)?query.round:'elimination';
 if(!UUID.test(campaignId)||!UUID.test(contestantId))notFound();
 const {db,user}=await requireCustomer(`/judge/${campaignId}/${contestantId}?round=${round}`);
 const {data:isJudge}=await db.rpc('is_contest_judge');if(!isJudge)redirect('/account');
 const [campaignResult,personResult,roundResult,entryResult,criteriaResult,cardResult]=await Promise.all([
  db.from('voting_campaigns').select('id,title,active').eq('id',campaignId).maybeSingle(),
  db.from('contestants').select('id,name,number,image_url,active').eq('id',contestantId).eq('campaign_id',campaignId).maybeSingle(),
  db.from('contest_scoring_rounds').select('scoring_open,opened_at').eq('campaign_id',campaignId).eq('round',round).maybeSingle(),
  db.from('contest_round_entries').select('contestant_id').eq('campaign_id',campaignId).eq('round',round).eq('contestant_id',contestantId).maybeSingle(),
  db.from('contest_scoring_criteria').select('*').eq('campaign_id',campaignId).order('position'),
  db.from('contest_scorecards').select('id,submitted_at').eq('campaign_id',campaignId).eq('contestant_id',contestantId).eq('judge_id',user.id).eq('round',round).maybeSingle(),
 ]);
 const campaign=campaignResult.data;const person=personResult.data;
 if(!campaign||!person||!campaign.active||!person.active)notFound();
 const criteria=(criteriaResult.data??[]) as ScoringCriterion[];
 const {data:scores}=cardResult.data?await db.from('contest_scores').select('criterion_id,score').eq('scorecard_id',cardResult.data.id):{data:[]};
 const previous=Object.fromEntries((scores??[]).map(item=>[item.criterion_id,Number(item.score)]));
 return <><AccountHeader/><main className="ticket-shell tabulation-shell judge-detail">
  <a className="text-link" href={`/judge?campaign=${campaignId}&round=${round}`}>← {roundDetails[round].label} contenders</a>
  <p className="eyebrow">{campaign.title} · {roundDetails[round].label} · Contestant {String(person.number).padStart(2,'0')}</p>
  <div className="judge-detail-heading">{person.image_url&&<img src={person.image_url} alt=""/>}<div><h1>{person.name}</h1><p>{cardResult.data?'Your scorecard was saved. You can revise it while scoring is open.':'Score every criterion before submitting.'}</p></div></div>
  {query.error&&<p className="notice" role="alert">{messages[query.error]??messages.save}</p>}
  {criteriaResult.error||roundResult.error||entryResult.error||criteria.length!==7?<p className="notice" role="alert">{messages.setup}</p>:
   round!=='elimination'&&!entryResult.data?<p className="notice">This contender has not advanced to {roundDetails[round].label}.</p>:
   !roundResult.data?.scoring_open?<p className="notice">{roundDetails[round].label} scoring is closed. Your submitted scores remain saved.</p>:
   <JudgeScoreForm campaignId={campaignId} contestantId={contestantId} round={round} criteria={criteria} previous={previous}/>}
 </main></>;
}
