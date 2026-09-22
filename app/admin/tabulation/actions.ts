'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import {UUID} from '@/lib/tickets';
import {isScoringRound} from '@/lib/tabulation';

async function admin(){const auth=await requireAdmin('/admin/tabulation');if(!auth.isAdmin)redirect('/account');return auth;}
function destination(campaign:string,code:string){const params=new URLSearchParams({error:code});if(UUID.test(campaign))params.set('campaign',campaign);redirect(`/admin/tabulation?${params}`);}

function roundDestination(campaign:string,round:string,code:string):never{
 const params=new URLSearchParams({error:code});
 if(UUID.test(campaign))params.set('campaign',campaign);
 if(isScoringRound(round))params.set('round',round);
 redirect(`/admin/tabulation?${params}`);
}

export async function saveRoundSettings(form:FormData){
 const {db}=await admin();const campaign=String(form.get('campaign_id')??'');const round=String(form.get('round')??'');
 if(!UUID.test(campaign)||!isScoringRound(round))roundDestination(campaign,round,'invalid');
 const {error}=await db.rpc('set_contest_round_state',{
  p_campaign_id:campaign,p_round:round,p_scoring_open:form.get('scoring_open')==='on',p_results_visible:form.get('results_visible')==='on',
 });
 if(error){
  const reason=error.message.includes('Close the current')?'other_open':error.message.includes('previous round')?'previous':
   error.message.includes('advancing contenders')?'entries':error.message.includes('inactive')?'inactive':'save';
  roundDestination(campaign,round,reason);
 }
 revalidatePath('/judge');revalidatePath('/admin/tabulation');revalidatePath('/contest/results');
 redirect(`/admin/tabulation?campaign=${campaign}&round=${round}&saved=settings`);
}

export async function saveRoundEntries(form:FormData){
 const {db}=await admin();const campaign=String(form.get('campaign_id')??'');const round=String(form.get('round')??'');
 if(!UUID.test(campaign)||!isScoringRound(round)||round==='elimination')roundDestination(campaign,round,'invalid');
 const contenders=form.getAll('contestant_id').map(String);
 if(contenders.length>10000||new Set(contenders).size!==contenders.length||contenders.some(id=>!UUID.test(id)))roundDestination(campaign,round,'invalid');
 const {error}=await db.rpc('set_contest_round_entries',{p_campaign_id:campaign,p_round:round,p_contestants:contenders});
 if(error)roundDestination(campaign,round,error.message.includes('locked')?'entries_locked':error.message.includes('previous round')?'unscored':'save');
 revalidatePath('/judge');revalidatePath('/admin/tabulation');revalidatePath('/contest/results');
 redirect(`/admin/tabulation?campaign=${campaign}&round=${round}&saved=entries`);
}

export async function saveTabulationRubric(form:FormData){
 const {db}=await admin();const campaign=String(form.get('campaign_id')??'');
 if(!UUID.test(campaign))destination(campaign,'invalid');
 const criteria=[...form.getAll('criterion_id')].map(String);
 if(criteria.length!==7||new Set(criteria).size!==7||criteria.some(id=>!UUID.test(id)))destination(campaign,'rubric');
 const payload=criteria.map(id=>({id,name:String(form.get(`name_${id}`)??'').trim(),weight:Number(form.get(`weight_${id}`))}));
 if(payload.some(item=>!item.name||item.name.length>100||!Number.isInteger(item.weight)||item.weight<1||item.weight>50))destination(campaign,'rubric');
 const {error}=await db.rpc('save_contest_rubric',{p_campaign_id:campaign,p_criteria:payload});
 if(error)destination(campaign,error.message.includes('locked')?'locked':'rubric');
 revalidatePath('/judge');revalidatePath('/contest/results');
 redirect(`/admin/tabulation?campaign=${campaign}&saved=rubric`);
}

export async function setJudgeAccess(form:FormData){
 const {db}=await admin();const user=String(form.get('user_id')??'');
 const judge=String(form.get('judge')??'');const search=String(form.get('search')??'').trim().slice(0,100);
 const params=new URLSearchParams();if(search)params.set('search',search);
 if(!UUID.test(user)||!['true','false'].includes(judge)){params.set('error','invalid');redirect(`/admin/tabulation?${params}`);}
 const {error}=await db.rpc('set_contest_judge',{p_user_id:user,p_judge:judge==='true'});
 if(error){params.set('error','save');redirect(`/admin/tabulation?${params}`);}
 revalidatePath('/judge');revalidatePath('/account');
 params.set('saved',judge==='true'?'assigned':'removed');
 redirect(`/admin/tabulation?${params}`);
}
