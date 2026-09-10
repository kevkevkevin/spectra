'use server';

import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import {UUID} from '@/lib/tickets';

const CAMPAIGN_LIMITS={eyebrow:80,headline:200,title:200,description:3000,prize:500,image:2000};
const CONTESTANT_LIMITS={name:120,description:1500,image:2000};
const SETUP_CODES=new Set(['42P01','42703','42883','PGRST202','PGRST204','PGRST205']);

type DbError={code?:string|null};

async function admin() {
 const auth=await requireAdmin('/admin/voting');
 if(!auth.isAdmin)redirect('/account');
 return auth;
}

function value(form:FormData,name:string) {return String(form.get(name)??'').trim();}

function isAllowedImageUrl(url:string) {
 if(!url)return true;
 if(url.length>2000||/\s/.test(url))return false;
 if(/^\/assets\/[A-Za-z0-9_./-]+$/.test(url)&&!url.split('/').includes('..'))return true;
 try {
  const parsed=new URL(url);
  return parsed.protocol==='https:'&&!parsed.username&&!parsed.password;
 } catch {
  return false;
 }
}

function saudiDate(raw:string) {
 if(!raw)return {valid:true,date:null as Date|null};
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))return {valid:false,date:null as Date|null};
 const date=new Date(`${raw}:00+03:00`);
 if(Number.isNaN(date.getTime()))return {valid:false,date:null as Date|null};
 const roundTrip=new Date(date.getTime()+3*60*60*1000).toISOString().slice(0,16);
 return {valid:roundTrip===raw,date:roundTrip===raw?date:null};
}

function destination(error:string) {redirect(`/admin/voting?error=${encodeURIComponent(error)}`);}

function databaseError(error:DbError|null) {
 if(error?.code&&SETUP_CODES.has(error.code))destination('setup');
 if(error?.code==='23505')destination('duplicate');
 destination('save');
}

function refreshVoting() {
 revalidatePath('/admin/voting');
 revalidatePath('/contest');
}

export async function saveVotingCampaign(form:FormData) {
 const {db}=await admin();
 const id=value(form,'id');
 const eventId=value(form,'event_id');
 const eyebrow=value(form,'eyebrow');
 const headline=value(form,'headline');
 const title=value(form,'title');
 const description=value(form,'description');
 const prize=value(form,'prize');
 const heroUrl=value(form,'hero_url');
 const opens=saudiDate(value(form,'opens_at'));
 const closes=saudiDate(value(form,'closes_at'));

 if((id&&!UUID.test(id))||!UUID.test(eventId)||!title||title.length>CAMPAIGN_LIMITS.title||eyebrow.length>CAMPAIGN_LIMITS.eyebrow||headline.length>CAMPAIGN_LIMITS.headline||description.length>CAMPAIGN_LIMITS.description||prize.length>CAMPAIGN_LIMITS.prize)destination('campaign');
 if(heroUrl.length>CAMPAIGN_LIMITS.image||!isAllowedImageUrl(heroUrl))destination('image');
 if(!opens.valid||!closes.valid||(opens.date&&closes.date&&opens.date.getTime()>=closes.date.getTime()))destination('date');

 const record={
  event_id:eventId,
  eyebrow,
  headline,
  title,
  description,
  prize,
  hero_url:heroUrl,
  active:form.get('active')==='on',
  results_visible:form.get('results_visible')==='on',
  opens_at:opens.date?.toISOString()??null,
  closes_at:closes.date?.toISOString()??null,
 };
 const result=id
  ?await db.from('voting_campaigns').update(record).eq('id',id).select('id').maybeSingle()
  :await db.from('voting_campaigns').insert(record).select('id').single();
 if(result.error||!result.data)databaseError(result.error);
 refreshVoting();
 redirect('/admin/voting?saved=campaign');
}

export async function saveContestant(form:FormData) {
 const {db}=await admin();
 const id=value(form,'id');
 const campaignId=value(form,'campaign_id');
 const numberRaw=value(form,'number');
 const positionRaw=value(form,'position');
 const name=value(form,'name');
 const description=value(form,'description');
 const imageUrl=value(form,'image_url');
 const number=Number(numberRaw);
 const position=Number(positionRaw);

 if((id&&!UUID.test(id))||!UUID.test(campaignId)||!/^\d+$/.test(numberRaw)||!Number.isInteger(number)||number<1||number>10000||!/^-?\d+$/.test(positionRaw)||!Number.isInteger(position)||position< -10000||position>10000||!name||name.length>CONTESTANT_LIMITS.name||description.length>CONTESTANT_LIMITS.description)destination('contestant');
 if(imageUrl.length>CONTESTANT_LIMITS.image||!isAllowedImageUrl(imageUrl))destination('image');

 const record={number,name,description,image_url:imageUrl,active:form.get('active')==='on',position};
 const result=id
  ?await db.from('contestants').update(record).eq('id',id).eq('campaign_id',campaignId).select('id').maybeSingle()
  :await db.from('contestants').insert({...record,campaign_id:campaignId}).select('id').single();
 if(result.error||!result.data)databaseError(result.error);
 refreshVoting();
 redirect(`/admin/voting?saved=${id?'contestant':'created'}`);
}
