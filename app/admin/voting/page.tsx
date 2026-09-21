import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import AccountHeader from '@/components/account-header';
import SubmitButton from '@/components/submit-button';
import {saveContestant,saveVotingCampaign} from './actions';
import '../../voting-admin.css';

export const dynamic='force-dynamic';

type VotingCampaign={
 id:string;
 event_id:string;
 eyebrow:string;
 headline:string;
 title:string;
 description:string;
 prize:string;
 hero_url:string;
 active:boolean;
 results_visible:boolean;
 opens_at:string|null;
 closes_at:string|null;
 created_at:string;
};

type Contestant={
 id:string;
 campaign_id:string;
 number:number;
 name:string;
 description:string;
 image_url:string;
 active:boolean;
 position:number;
 created_at:string;
 updated_at:string;
};

type TicketEvent={id:string;title:string;starts_at:string|null;active:boolean};
type TallyRow={id:string;number:number;name:string;description:string;image_url:string;position:number;vote_count:number|string|null;share_percent:number|string|null};
type PageParams={saved?:string|string[];error?:string|string[]};

const errors:Record<string,string>={
 setup:'Voting management needs database update 005. Apply 005_ticket_voting.sql in Supabase, then reload this page.',
 campaign:'Check the campaign fields. A title and linked ticket event are required.',
 contestant:'Check the contestant name, number, and display position, then save again.',
 image:'Use an HTTPS image URL or a local path beginning with /assets/.',
 date:'Check the Saudi voting times. The closing time must be later than the opening time.',
 duplicate:'That contestant number is already used in this campaign. Choose another number.',
 save:'The change could not be saved. Check your access and database setup, then try again.',
};

const numberFormat=new Intl.NumberFormat('en-US');

function setupError(error:unknown) {
 const code=typeof error==='object'&&error&&'code' in error?String((error as {code?:unknown}).code??''):'';
 return ['42P01','42703','42883','PGRST202','PGRST204','PGRST205'].includes(code);
}

function saudiInput(value:string|null) {
 return value?new Date(new Date(value).getTime()+3*60*60*1000).toISOString().slice(0,16):'';
}

function eventDate(value:string|null) {
 if(!value)return 'Date to be announced';
 return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(value));
}

function campaignState(campaign:VotingCampaign) {
 const now=Date.now();
 if(!campaign.active)return {label:'Voting paused',className:'rejected'};
 if(campaign.opens_at&&new Date(campaign.opens_at).getTime()>now)return {label:'Scheduled',className:''};
 if(campaign.closes_at&&new Date(campaign.closes_at).getTime()<=now)return {label:'Voting closed',className:'rejected'};
 return {label:'Voting live',className:'approved'};
}

function numeric(value:number|string|null) {
 if(value===null)return null;
 const parsed=Number(value);
 return Number.isFinite(parsed)?parsed:null;
}

function CampaignForm({campaign,events}:{campaign?:VotingCampaign;events:TicketEvent[]}) {
 return <form action={saveVotingCampaign} className="voting-campaign-form">
  <input type="hidden" name="id" value={campaign?.id??''}/>
  {campaign?.hero_url&&<figure className="voting-hero-preview"><img src={campaign.hero_url} alt="Campaign hero preview" referrerPolicy="no-referrer"/><figcaption>Current campaign hero</figcaption></figure>}
  <div className="voting-form-grid">
   <label className="voting-wide-field">Linked ticket event
    <select name="event_id" defaultValue={campaign?.event_id??''} required>
     <option value="" disabled>Choose the event whose tickets can vote</option>
     {events.map(event=><option value={event.id} key={event.id}>{event.title} · {eventDate(event.starts_at)}{event.active?'':' · bookings paused'}</option>)}
    </select>
    <small>Every issued ticket for this event receives one ballot in the contest.</small>
   </label>
   <label>Eyebrow
    <input name="eyebrow" defaultValue={campaign?.eyebrow??''} maxLength={80} placeholder="SPECTRA’S NEXT SINGING IDOL"/>
   </label>
   <label>Hero headline
    <input name="headline" defaultValue={campaign?.headline??''} maxLength={200} placeholder="Cast your vote"/>
   </label>
   <label className="voting-wide-field">Contest title
    <input name="title" defaultValue={campaign?.title??''} required maxLength={200} placeholder="Meet the Top 21"/>
   </label>
   <label className="voting-wide-field">Introduction
    <textarea name="description" defaultValue={campaign?.description??''} maxLength={3000} rows={4} placeholder="Tell guests how the contest works."/>
   </label>
   <label className="voting-wide-field">Prize line
    <textarea name="prize" defaultValue={campaign?.prize??''} maxLength={500} rows={2} placeholder="What the winner receives"/>
   </label>
   <label className="voting-wide-field">Hero image URL
    <input name="hero_url" type="text" inputMode="url" defaultValue={campaign?.hero_url??'/assets/reference/contest-top21.jpg'} maxLength={2000} placeholder="https://… or /assets/…"/>
    <small>Use an HTTPS address or a file already stored below /assets/.</small>
   </label>
   <label>Voting opens (Saudi Arabia)
    <input name="opens_at" type="datetime-local" defaultValue={saudiInput(campaign?.opens_at??null)}/>
    <small>Optional. Leave empty to open as soon as voting is active.</small>
   </label>
   <label>Voting closes (Saudi Arabia)
    <input name="closes_at" type="datetime-local" defaultValue={saudiInput(campaign?.closes_at??null)}/>
    <small>Optional. Leave empty to keep voting open.</small>
   </label>
  </div>
  <fieldset className="voting-switches">
   <legend>Campaign controls</legend>
   <label className="check"><input type="checkbox" name="active" defaultChecked={campaign?.active??false}/><span><strong>Accept votes</strong><small>The time window still applies when this is on.</small></span></label>
   <label className="check"><input type="checkbox" name="results_visible" defaultChecked={campaign?.results_visible??false}/><span><strong>Show live results</strong><small>Vote totals and percentages appear on the public contest page.</small></span></label>
  </fieldset>
  <SubmitButton disabled={events.length===0} pending="Saving campaign…">{campaign?'Save campaign':'Create campaign'}</SubmitButton>
  {events.length===0&&<p className="voting-form-note">Create a ticket event before setting up its voting campaign.</p>}
 </form>;
}

function ContestantForm({campaignId,contestant,votes,nextNumber,nextPosition}:{campaignId:string;contestant?:Contestant;votes?:TallyRow;nextNumber:number;nextPosition:number}) {
 const count=numeric(votes?.vote_count??null);
 const share=numeric(votes?.share_percent??null);
 return <article className={`voting-contestant-editor${contestant&&!contestant.active?' is-inactive':''}`} id={contestant?`contestant-${contestant.id}`:undefined}>
  <div className="voting-contestant-visual">
   {contestant?.image_url?<img src={contestant.image_url} alt={`${contestant.name} preview`} loading="lazy" referrerPolicy="no-referrer"/>:<div className="voting-image-placeholder" aria-hidden="true"><span>{contestant?String(contestant.number).padStart(2,'0'):'+'}</span></div>}
   <span className="voting-number-chip">#{String(contestant?.number??nextNumber).padStart(2,'0')}</span>
  </div>
  <form action={saveContestant} className="voting-contestant-form">
   <input type="hidden" name="id" value={contestant?.id??''}/>
   <input type="hidden" name="campaign_id" value={campaignId}/>
   <div className="voting-editor-heading">
    <div><p className="eyebrow">{contestant?'Contestant profile':'Add to the lineup'}</p><h3>{contestant?.name||'New contestant'}</h3></div>
    {contestant&&<div className="voting-person-tally"><strong>{count===null?'—':numberFormat.format(count)}</strong><span>{count===null?'Tally hidden':`${share===null?'—':share.toFixed(1)}% · votes`}</span></div>}
   </div>
   <div className="voting-contestant-fields">
    <label>Number<input name="number" type="number" required min={1} max={10000} step={1} defaultValue={contestant?.number??nextNumber}/></label>
    <label>Display position<input name="position" type="number" required min={-10000} max={10000} step={1} defaultValue={contestant?.position??nextPosition}/></label>
    <label className="voting-wide-field">Name<input name="name" required maxLength={120} defaultValue={contestant?.name??''} placeholder="Contestant name"/></label>
    <label className="voting-wide-field">Profile description<textarea name="description" maxLength={1500} rows={3} defaultValue={contestant?.description??''} placeholder="A short introduction for voters"/></label>
    <label className="voting-wide-field">Portrait image URL<input name="image_url" type="text" inputMode="url" maxLength={2000} defaultValue={contestant?.image_url??''} placeholder="https://… or /assets/contest/…"/><small>Use an HTTPS address or a local /assets/ path.</small></label>
   </div>
   <div className="voting-contestant-actions">
    <label className="check"><input type="checkbox" name="active" defaultChecked={contestant?.active??true}/><span><strong>Show on ballot</strong><small>Turn this off to deactivate the profile without removing its vote history.</small></span></label>
    <SubmitButton pending={contestant?'Saving…':'Adding…'}>{contestant?'Save contestant':'Add contestant'}</SubmitButton>
   </div>
  </form>
 </article>;
}

export default async function VotingAdmin({searchParams}:{searchParams:Promise<PageParams>}) {
 const {db,isAdmin}=await requireAdmin('/admin/voting');
 if(!isAdmin)redirect('/account');
 const query=await searchParams;
 const [campaignResult,contestantResult,eventResult]=await Promise.all([
  db.from('voting_campaigns').select('*').order('created_at',{ascending:false}),
  db.from('contestants').select('*').order('position',{ascending:true}).order('number',{ascending:true}),
  db.from('ticket_events').select('id,title,starts_at,active').order('created_at',{ascending:true}),
 ]);
 const campaigns=(campaignResult.data??[]) as VotingCampaign[];
 const contestants=(contestantResult.data??[]) as Contestant[];
 const events=(eventResult.data??[]) as TicketEvent[];
 const tallyResults=await Promise.all(campaigns.map(campaign=>db.rpc('contest_public_tally',{p_campaign_id:campaign.id})));
 const tallies=new Map<string,TallyRow[]>(campaigns.map((campaign,index)=>[campaign.id,(tallyResults[index]?.data??[]) as TallyRow[]]));
 const tallyErrors=tallyResults.map(result=>result.error).filter(Boolean);
 const baseErrors=[campaignResult.error,contestantResult.error,eventResult.error].filter(Boolean);
 const migrationMissing=[...baseErrors,...tallyErrors].some(setupError);
 const requestedError=typeof query.error==='string'?query.error:'';
 const saved=typeof query.saved==='string'?query.saved:'';

 return <><AccountHeader/><main className="ticket-shell voting-admin-shell">
  <nav className="admin-section-nav voting-admin-nav" aria-label="Voting administration links">
   <a href="/admin/tickets">Ticket desk</a>
   <a href="/admin/staff">Staff</a>
   <a href="/admin/tickets/settings">Events</a>
   <a href="/admin/tabulation">Judge tabulation</a>
   <a href="/contest" target="_blank" rel="noopener noreferrer">Contest public ↗</a>
  </nav>
  <p className="eyebrow">Contest control room</p>
  <div className="ticket-title-row"><h1>Shape the spotlight.</h1><a className="button button-outline" href="/contest" target="_blank" rel="noopener noreferrer">Preview public page ↗</a></div>
  <p className="ticket-intro">Manage the live ballot, campaign story, and contestant lineup. Eligibility follows the linked event automatically: each issued ticket can cast one vote.</p>

  {saved==='campaign'&&<p className="notice voting-save-notice" role="status">Campaign settings saved. The public contest page is up to date.</p>}
  {saved==='contestant'&&<p className="notice voting-save-notice" role="status">Contestant changes saved.</p>}
  {saved==='created'&&<p className="notice voting-save-notice" role="status">Contestant added to the lineup.</p>}
  {requestedError&&<p className="notice voting-error-notice" role="alert">{errors[requestedError]??errors.save}</p>}
  {migrationMissing&&<p className="notice voting-error-notice" role="alert">{errors.setup}</p>}
  {!migrationMissing&&baseErrors.length>0&&<p className="notice voting-error-notice" role="alert">Voting data could not be loaded. Reload the page to try again.</p>}
  {!migrationMissing&&tallyErrors.length>0&&<p className="notice voting-error-notice" role="alert">Vote totals are temporarily unavailable. Campaign and contestant editing still works.</p>}

  {!migrationMissing&&<section className="voting-rule-card" aria-label="Voting rule">
   <span className="voting-rule-icon" aria-hidden="true">01</span>
   <div><strong>One ticket. One vote.</strong><p>Only approved, issued tickets from the linked event are eligible. A ticket cannot vote twice in the same campaign.</p></div>
   <dl><div><dt>Campaigns</dt><dd>{campaigns.length}</dd></div><div><dt>Profiles</dt><dd>{contestants.length}</dd></div></dl>
  </section>}

  {!migrationMissing&&campaigns.map(campaign=>{
   const state=campaignState(campaign);
   const campaignContestants=contestants.filter(contestant=>contestant.campaign_id===campaign.id);
   const rows=tallies.get(campaign.id)??[];
   const rowMap=new Map(rows.map(row=>[row.id,row]));
    const disclosed=!tallyErrors.length&&rows.some(row=>numeric(row.vote_count)!==null);
   const total=disclosed?rows.reduce((sum,row)=>sum+(numeric(row.vote_count)??0),0):null;
   const nextNumber=Math.min(10000,Math.max(0,...campaignContestants.map(item=>item.number))+1);
   const nextPosition=Math.min(10000,Math.max(0,...campaignContestants.map(item=>item.position))+1);
   const linkedEvent=events.find(event=>event.id===campaign.event_id);
   return <section className="ticket-panel voting-campaign-card" key={campaign.id}>
    <header className="voting-campaign-heading">
     <div><p className="eyebrow">{campaign.eyebrow||'Voting campaign'}</p><h2>{campaign.title}</h2><p>{linkedEvent?`Linked to ${linkedEvent.title}`:'Linked ticket event unavailable'}</p></div>
     <div className="voting-campaign-status"><div><span className={`status-badge ${state.className}`}>{state.label}</span><span className={`status-badge ${campaign.results_visible?'approved':''}`}>{campaign.results_visible?'Results public':'Results private'}</span></div><div className="voting-campaign-tally"><strong>{total===null?'—':numberFormat.format(total)}</strong><span>{total===null?'Tally hidden':'campaign votes'}</span></div></div>
    </header>
    <CampaignForm campaign={campaign} events={events}/>

    <div className="voting-lineup-heading"><div><p className="eyebrow">Ballot lineup</p><h2>Contestants</h2></div><p>{campaignContestants.length} profiles · {campaignContestants.filter(item=>item.active).length} active</p></div>
    <div className="voting-contestant-list">
     {campaignContestants.map(contestant=><ContestantForm campaignId={campaign.id} contestant={contestant} votes={rowMap.get(contestant.id)} nextNumber={nextNumber} nextPosition={nextPosition} key={contestant.id}/>) }
     <ContestantForm campaignId={campaign.id} nextNumber={nextNumber} nextPosition={nextPosition}/>
    </div>
   </section>;
  })}

  {!migrationMissing&&campaigns.length===0&&<section className="ticket-panel voting-campaign-card voting-new-campaign">
   <header className="voting-campaign-heading"><div><p className="eyebrow">First campaign</p><h2>Open the ballot.</h2><p>Link a ticketed event and create the public contest.</p></div></header>
   <CampaignForm events={events}/>
  </section>}
 </main></>;
}
