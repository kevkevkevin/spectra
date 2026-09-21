'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import {UUID} from '@/lib/tickets';

async function admin(){const auth=await requireAdmin('/admin/tabulation');if(!auth.isAdmin)redirect('/account');return auth;}
function destination(campaign:string,code:string){const params=new URLSearchParams({error:code});if(UUID.test(campaign))params.set('campaign',campaign);redirect(`/admin/tabulation?${params}`);}

export async function saveTabulationSettings(form:FormData){
 const {db}=await admin();const campaign=String(form.get('campaign_id')??'');
 if(!UUID.test(campaign))destination(campaign,'invalid');
 const {data,error}=await db.from('contest_scoring_settings').update({
  scoring_open:form.get('scoring_open')==='on',
  results_visible:form.get('results_visible')==='on',
 }).eq('campaign_id',campaign).select('campaign_id').maybeSingle();
 if(error||!data)destination(campaign,'save');
 revalidatePath('/judge');revalidatePath('/contest/results');
 redirect(`/admin/tabulation?campaign=${campaign}&saved=settings`);
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
