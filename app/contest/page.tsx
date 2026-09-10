import type {Metadata} from 'next';
import AccountHeader from '@/components/account-header';
import ContestVote,{type ContestantTally,type ContestTicketStatus} from '@/components/contest-vote';
import SiteFooter from '@/components/site-footer';
import {createClient,isConfigured} from '@/lib/supabase/server';
import {WHATSAPP} from '@/lib/site-content';
import './contest.css';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Top 21 Official Contenders — Spectra’s Next Singing Idol',description:'Meet the Top 21 and use each approved Spectra ticket to cast one final vote for your star.'};

type Campaign={id:string;eyebrow:string|null;headline:string|null;title:string|null;description:string|null;prize:string|null;hero_url:string|null;active:boolean;opens_at:string|null;closes_at:string|null};

const previewContestants:ContestantTally[]=Array.from({length:21},(_,index)=>{
 const number=index+1;
 return {id:`preview-${String(number).padStart(2,'0')}`,number,name:`Contender ${String(number).padStart(2,'0')}`,description:'Official Top 21 contender',image_url:`/assets/contest/c${String(number).padStart(2,'0')}.jpg`,position:number,vote_count:null,share_percent:null};
});

function row<T>(data:T|T[]|null):T|null{return Array.isArray(data)?data[0]??null:data;}
function campaignIsOpen(campaign:Campaign|null){
 if(!campaign?.active)return false;
 const now=Date.now();
 const opens=campaign.opens_at?Date.parse(campaign.opens_at):null;
 const closes=campaign.closes_at?Date.parse(campaign.closes_at):null;
 return (opens===null||Number.isNaN(opens)||now>=opens)&&(closes===null||Number.isNaN(closes)||now<closes);
}

export default async function ContestPage(){
 let campaign:Campaign|null=null;
 let contestants:ContestantTally[]=[];
 let ticketStatus:ContestTicketStatus|null=null;
 let signedIn=false;
 let setupReady=false;

 if(isConfigured()){
  try{
   const db=await createClient();
   const [auth,campaignResult]=await Promise.all([
    db.auth.getUser(),
    db.from('voting_campaigns').select('id,eyebrow,headline,title,description,prize,hero_url,active,opens_at,closes_at').eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle(),
   ]);
   signedIn=Boolean(auth.data.user);
   campaign=campaignResult.data as Campaign|null;
   if(campaign&&!campaignResult.error){
    const [tallyResult,statusResult]=await Promise.all([
     db.rpc('contest_public_tally',{p_campaign_id:campaign.id}),
     signedIn?db.rpc('contest_vote_status',{p_campaign_id:campaign.id}):Promise.resolve({data:null,error:null}),
    ]);
    contestants=(tallyResult.data??[]).map((item:Record<string,unknown>)=>({id:String(item.id),number:Number(item.number),name:String(item.name),description:typeof item.description==='string'?item.description:null,image_url:typeof item.image_url==='string'?item.image_url:null,position:item.position===null?null:Number(item.position),vote_count:item.vote_count===null?null:Number(item.vote_count),share_percent:item.share_percent===null?null:Number(item.share_percent)}));
    const status=row(statusResult.data as ContestTicketStatus|ContestTicketStatus[]|null);
    ticketStatus=status?{eligible:Number(status.eligible),used:Number(status.used),remaining:Number(status.remaining)}:null;
    setupReady=!tallyResult.error&&(!signedIn||!statusResult.error)&&contestants.length>0;
   }
  }catch{/* The full preview remains available until voting is configured. */}
 }

 const roster=setupReady?contestants:previewContestants;
 const eyebrow=campaign?.eyebrow||'Elimination rounds';
 const campaignHeadline=campaign?.headline||'TOP 21 Official Contenders';
 const headlineMatch=campaignHeadline.match(/^(.*?)\s*(Official Contenders)$/i);
 const headline=headlineMatch?.[1]||campaignHeadline;
 const title=headlineMatch?.[2]||campaign?.title||'Official Contenders';
 const description=campaign?.description||'The Top 21 official contenders take the Bora stage. Two elimination nights. One house vote. One star.';
 const prize=(campaign?.prize||'100,000 PHP').replace(/^grand prize\s*[·:—-]?\s*/i,'');
 const hero=campaign?.hero_url||'/assets/reference/contest-top21.jpg';

 return <div className="contest-page" id="top">
  <a className="skip" href="#contest-main">Skip to content</a>
  <AccountHeader/>
  <main id="contest-main">
   <section className="contest-hero" aria-labelledby="contest-title">
    <div className="contest-hero-copy"><p className="eyebrow">{eyebrow}</p><h1 id="contest-title"><strong>{headline}</strong><em>{title}</em></h1><p className="contest-hero-tagline">One stage. One voice. One star.</p><p className="contest-hero-intro">{description}</p><div className="contest-event-panel"><span><small>Venue</small>Bora Cafe &amp; Restaurant</span><span><small>Elimination rounds</small>September 18 and September 25</span><span><small>Showtime</small>3PM</span><span className="contest-prize"><small>Grand prize</small>{prize}</span></div><div className="button-row"><a className="button contest-gold-button" href="#vote">Cast your vote <span aria-hidden="true">↓</span></a><a className="button button-outline" href="/tickets">Tickets <span aria-hidden="true">↗</span></a></div></div>
    <div className="contest-hero-poster"><span className="contest-poster-halo" aria-hidden="true"/><img src={hero} alt="Top 21 official contenders — Spectra’s Next Singing Idol" fetchPriority="high"/></div>
   </section>

   <section className="contest-house" aria-labelledby="house-title"><div className="contest-section-heading"><p className="eyebrow">The house</p><h2 id="house-title">Coaches, judges, hosts</h2></div><div className="contest-house-grid"><div className="contest-house-group"><p>Team coaches</p><div className="contest-face-row">{[1,2,3].map(number=><img key={number} src={`/assets/contest/coach-${number}.jpg`} alt="Spectra team coach" loading="lazy"/>)}</div></div><div className="contest-house-group"><p>Resident judge-coaches</p><div className="contest-face-row">{[1,2,3].map(number=><img key={number} src={`/assets/contest/judge-${number}.jpg`} alt="Spectra resident judge-coach" loading="lazy"/>)}</div></div><div className="contest-house-group contest-hosts"><p>Hosted by</p><div className="contest-host-row"><figure><img src="/assets/contest/host-bon.jpg" alt="Bon, contest host" loading="lazy"/><figcaption>Bon</figcaption></figure><figure><img src="/assets/contest/host-ryan.jpg" alt="Ryan, contest host" loading="lazy"/><figcaption>Ryan</figcaption></figure></div></div></div></section>

   <ContestVote campaignId={setupReady?campaign?.id??null:null} contestants={roster} signedIn={signedIn} ticketStatus={ticketStatus} setupReady={setupReady} votingOpen={campaignIsOpen(campaign)}/>

   <section className="contest-room-cta" aria-labelledby="room-title"><p className="eyebrow">Live at Bora Cafe &amp; Restaurant · 3PM</p><h2 id="room-title">Be in the <em>room.</em></h2><p>Come watch the elimination nights, then use your approved ticket to vote for the voice you want to keep on stage.</p><div className="button-row"><a className="button contest-gold-button" href="/tickets">Get tickets <span aria-hidden="true">↗</span></a><a className="button button-outline" href={WHATSAPP} target="_blank" rel="noopener noreferrer">Book a table <span aria-hidden="true">↗</span></a></div></section>
  </main>
  <SiteFooter/>
 </div>;
}
