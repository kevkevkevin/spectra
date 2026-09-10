'use server';

import {revalidatePath} from 'next/cache';
import {createClient,isConfigured} from '@/lib/supabase/server';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ContestVoteState={
 status:'idle'|'success'|'error';
 message:string;
 contestantId?:string;
 remaining?:number;
};

export async function castContestVote(_previous:ContestVoteState,form:FormData):Promise<ContestVoteState>{
 const campaignId=String(form.get('campaign_id')??'');
 const contestantId=String(form.get('contestant_id')??'');
 if(!UUID.test(campaignId)||!UUID.test(contestantId)) return {status:'error',message:'Choose a valid contender and try again.',contestantId};
 if(!isConfigured()) return {status:'error',message:'Voting is still being prepared. Please check back soon.',contestantId};

 try{
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user) return {status:'error',message:'Your session has ended. Sign in again to vote.',contestantId};

  const {data,error}=await db.rpc('cast_contest_vote',{p_campaign_id:campaignId,p_contestant_id:contestantId});
  if(error){
   const known:[string,string][]=[
    ['Sign in required','Your session has ended. Sign in again to vote.'],
    ['Confirm your email first','Confirm your email before casting your vote.'],
    ['Voting is not open','Voting is not open right now.'],
    ['Contestant is not available','That contender is not available for voting. Refresh the page and choose again.'],
    ['No unused eligible ticket remains','All votes attached to your approved tickets have already been used.'],
   ];
   return {status:'error',message:known.find(([needle])=>error.message.includes(needle))?.[1]??'Your vote could not be recorded. Please try again.',contestantId};
  }

  const row=Array.isArray(data)?data[0]:data;
  const remaining=Number(row?.remaining);
  revalidatePath('/contest');
  return {status:'success',message:'Your vote is in. Thank you for choosing your star.',contestantId,remaining:Number.isFinite(remaining)?remaining:0};
 }catch{
  return {status:'error',message:'Your vote could not be recorded. Please try again.',contestantId};
 }
}
