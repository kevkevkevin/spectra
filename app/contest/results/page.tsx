import type {Metadata} from 'next';
import {createClient as createAnonymousClient} from '@supabase/supabase-js';
import AccountHeader from '@/components/account-header';
import TabulationLeaderboard from '@/components/tabulation-leaderboard';
import {isConfigured} from '@/lib/supabase/server';
import {isScoringRound,roundDetails,scoringRounds,type LeaderboardRow,type RoundSettings} from '@/lib/tabulation';
import '../../tabulation.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Contest Results — Spectra',description:'Live judge tabulation for the Spectra singing contest.'};
export default async function PublicContestResults({searchParams}:{searchParams:Promise<{round?:string}>}){
 const query=await searchParams;
 let campaign:{id:string;title:string}|null=null;
 let rows:LeaderboardRow[]=[];
 let visibleRounds:RoundSettings[]=[];
 if(isConfigured()){
  const db=createAnonymousClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data}=await db.from('voting_campaigns').select('id,title').eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle();
  campaign=data;
  if(campaign){
   const roundResult=await db.from('contest_scoring_rounds').select('*').eq('campaign_id',campaign.id).eq('results_visible',true);
   visibleRounds=(roundResult.data??[]) as RoundSettings[];
  }
 }
 const available=scoringRounds.filter(round=>visibleRounds.some(item=>item.round===round));
 const selectedRound=isScoringRound(query.round)&&available.includes(query.round)?query.round:available.at(-1);
 if(campaign&&selectedRound&&isConfigured()){
  const db=createAnonymousClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const results=await db.rpc('contest_judge_leaderboard',{p_campaign_id:campaign.id,p_round:selectedRound});
  rows=(results.data??[]) as LeaderboardRow[];
 }
 return <><AccountHeader/><main className="ticket-shell tabulation-shell public-tabulation">
  <a className="text-link" href="/contest">← Contest and audience vote</a><p className="eyebrow">Official contest tabulation</p><h1>Every note counts.</h1>
  <p className="ticket-intro">Voice quality 50%. Stage presence 30%. Audience impact 20%. Each judge scores seven subcriteria, and completed judge totals are averaged.</p>
  {!campaign?<p className="notice">Contest results are being prepared.</p>:!selectedRound?<p className="notice">Judge results have not been published yet.</p>:<section className="ticket-panel"><p className="eyebrow">{campaign.title}</p><nav className="tabulation-round-tabs" aria-label="Published result rounds">{available.map(round=><a key={round} href={`/contest/results?round=${round}`} aria-current={selectedRound===round?'page':undefined}><strong>{roundDetails[round].label}</strong><small>Results</small></a>)}</nav><TabulationLeaderboard key={selectedRound} campaignId={campaign.id} round={selectedRound} initialRows={rows} publicView/></section>}
  <p className="tabulation-rule-note">Ticket-backed audience votes are tracked separately from the judges’ Audience Impact criterion.</p>
 </main></>;
}
