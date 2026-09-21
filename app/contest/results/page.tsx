import type {Metadata} from 'next';
import {createClient as createAnonymousClient} from '@supabase/supabase-js';
import AccountHeader from '@/components/account-header';
import TabulationLeaderboard from '@/components/tabulation-leaderboard';
import {isConfigured} from '@/lib/supabase/server';
import type {LeaderboardRow} from '@/lib/tabulation';
import '../../tabulation.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Contest Results — Spectra',description:'Live judge tabulation for the Spectra singing contest.'};
export default async function PublicContestResults(){
 let campaign:{id:string;title:string}|null=null;
 let rows:LeaderboardRow[]=[];
 if(isConfigured()){
  const db=createAnonymousClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data}=await db.from('voting_campaigns').select('id,title').eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle();
  campaign=data;
  if(campaign){
   const results=await db.rpc('contest_judge_leaderboard',{p_campaign_id:campaign.id});
   rows=(results.data??[]) as LeaderboardRow[];
  }
 }
 return <><AccountHeader/><main className="ticket-shell tabulation-shell public-tabulation">
  <a className="text-link" href="/contest">← Contest and audience vote</a><p className="eyebrow">Official contest tabulation</p><h1>Every note counts.</h1>
  <p className="ticket-intro">Voice quality 50%. Stage presence 30%. Audience impact 20%. Each judge scores seven subcriteria, and completed judge totals are averaged.</p>
  {!campaign?<p className="notice">Contest results are being prepared.</p>:<section className="ticket-panel"><p className="eyebrow">{campaign.title}</p><TabulationLeaderboard campaignId={campaign.id} initialRows={rows} publicView/></section>}
  <p className="tabulation-rule-note">Ticket-backed audience votes are tracked separately from the judges’ Audience Impact criterion.</p>
 </main></>;
}
