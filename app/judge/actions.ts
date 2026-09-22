'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireCustomer} from '@/lib/customer';
import {UUID} from '@/lib/tickets';
import {isScoringRound} from '@/lib/tabulation';

export async function submitJudgeScorecard(form:FormData){
 const campaign=String(form.get('campaign_id')??'');
 const contestant=String(form.get('contestant_id')??'');
 const round=String(form.get('round')??'');
 if(!UUID.test(campaign)||!UUID.test(contestant))redirect('/judge?error=invalid');
 if(!isScoringRound(round))redirect(`/judge?campaign=${campaign}&error=invalid`);
 const target=`/judge/${campaign}/${contestant}?round=${round}`;
 const {db}=await requireCustomer(target);
 const {data:isJudge,error:roleError}=await db.rpc('is_contest_judge');
 if(roleError||!isJudge)redirect('/account');
 const {data:criteria,error:criteriaError}=await db.from('contest_scoring_criteria')
  .select('id').eq('campaign_id',campaign).order('position');
 if(criteriaError||criteria?.length!==7)redirect(`${target}&error=setup`);
 const scores=criteria.map(criterion=>{
  const raw=String(form.get(`score_${criterion.id}`)??'').trim();
  return {criterion_id:criterion.id,raw,score:Number(raw)};
 });
 if(scores.some(item=>!item.raw||!Number.isFinite(item.score)||item.score<0||item.score>10||Math.abs(Math.round(item.score*100)-item.score*100)>1e-7)){
  redirect(`${target}&error=score`);
 }
 const {error}=await db.rpc('submit_contest_scorecard',{
  p_campaign_id:campaign,p_contestant_id:contestant,p_round:round,p_scores:scores.map(({criterion_id,score})=>({criterion_id,score})),
 });
 if(error){
  const reason=error.message.includes('closed')?'closed':error.message.includes('Judge access')?'access':'save';
  redirect(`${target}&error=${reason}`);
 }
 revalidatePath('/judge');revalidatePath('/admin/tabulation');revalidatePath('/contest/results');
 redirect(`/judge?campaign=${campaign}&round=${round}&saved=1`);
}
