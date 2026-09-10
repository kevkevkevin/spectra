'use client';

import {useActionState,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {castContestVote,type ContestVoteState} from '@/app/contest/actions';

export type ContestantTally={
 id:string;
 number:number;
 name:string;
 description:string|null;
 image_url:string|null;
 position:number|null;
 vote_count:number|null;
 share_percent:number|null;
};

export type ContestTicketStatus={eligible:number;used:number;remaining:number};

const initialState:ContestVoteState={status:'idle',message:''};

function portrait(contestant:ContestantTally){
 return contestant.image_url||`/assets/contest/c${String(contestant.number).padStart(2,'0')}.jpg`;
}

function VoteCard({contestant,selected,onSelect,mode}:{contestant:ContestantTally;selected:boolean;onSelect:()=>void;mode:'vote'|'signin'|'tickets'|'closed'|'preview'}){
 const visible=contestant.vote_count!==null&&contestant.share_percent!==null;
 const content=<>
  <span className="contest-card-image"><img src={portrait(contestant)} alt={`Portrait of ${contestant.name}`} loading="lazy"/><span className="contestant-number">{String(contestant.number).padStart(2,'0')}</span>{selected&&<span className="contest-selected-mark" aria-hidden="true">✓</span>}</span>
  <span className="contest-card-copy"><span className="contestant-name">{contestant.name}</span>{contestant.description&&<span className="contestant-description">{contestant.description}</span>}<span className="contest-card-result">{visible?<><strong>{contestant.vote_count} {contestant.vote_count===1?'vote':'votes'}</strong><span>{contestant.share_percent}%</span></>:<span>Results announced by the house</span>}</span><span className="contest-result-track" aria-hidden="true"><span style={{width:visible?`${Math.max(0,Math.min(100,contestant.share_percent!))}%`:'0%'}}/></span></span>
 </>;
 if(mode==='vote') return <label className={`contestant-card ${selected?'selected':''}`}><input type="radio" name="contestant-choice" value={contestant.id} checked={selected} onChange={onSelect}/>{content}<span className="contest-card-action">{selected?'Selected — review below':'Choose this contender'}</span></label>;
 return <article className="contestant-card" role="listitem">{content}{mode==='signin'?<a className="contest-card-action" href="/login?next=/contest">Sign in to vote</a>:mode==='tickets'?<a className="contest-card-action" href="/tickets">Get a ticket to vote</a>:<span className="contest-card-action disabled">{mode==='closed'?'Voting closed':'Preview only'}</span>}</article>;
}

export default function ContestVote({campaignId,contestants,signedIn,ticketStatus,setupReady,votingOpen}:{campaignId:string|null;contestants:ContestantTally[];signedIn:boolean;ticketStatus:ContestTicketStatus|null;setupReady:boolean;votingOpen:boolean}){
 const router=useRouter();
 const [selectedId,setSelectedId]=useState('');
 const [confirmOpen,setConfirmOpen]=useState(false);
 const [toast,setToast]=useState('');
 const [state,action,pending]=useActionState(castContestVote,initialState);
 const dialogRef=useRef<HTMLDivElement>(null);
 const reviewButtonRef=useRef<HTMLButtonElement>(null);
 const selected=contestants.find(item=>item.id===selectedId)??null;
 const remaining=state.status==='success'&&typeof state.remaining==='number'?state.remaining:(ticketStatus?.remaining??0);
 const canVote=Boolean(setupReady&&votingOpen&&signedIn&&campaignId&&remaining>0);
 const visibleResults=contestants.some(item=>item.vote_count!==null&&item.share_percent!==null);
 const totalVotes=visibleResults?contestants.reduce((sum,item)=>sum+(item.vote_count??0),0):null;
 const leaderboard=useMemo(()=>[...contestants].sort((a,b)=>{
  if(visibleResults){
   const voteDifference=(b.vote_count??0)-(a.vote_count??0);
   if(voteDifference!==0)return voteDifference;
  }
  return (a.position??999)-(b.position??999)||a.number-b.number;
 }),[contestants,visibleResults]);
 const cardMode:'vote'|'signin'|'tickets'|'closed'|'preview'=canVote?'vote':!setupReady?'preview':!votingOpen?'closed':!signedIn?'signin':'tickets';

 useEffect(()=>{
  if(!setupReady)return;
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!pending)router.refresh();},12000);
  return ()=>window.clearInterval(timer);
 },[pending,router,setupReady]);

 useEffect(()=>{
  if(state.status!=='success')return;
  setConfirmOpen(false);
  setToast(state.message);
  router.refresh();
  const timer=window.setTimeout(()=>setToast(''),5200);
  return ()=>window.clearTimeout(timer);
 },[state.status,state.contestantId,state.remaining,state.message,router]);

 useEffect(()=>{
  if(!confirmOpen)return;
  const dialog=dialogRef.current;
  const controls=dialog?[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([type="hidden"])')]:[];
  controls[0]?.focus();
  const handleKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!pending){
    setConfirmOpen(false);
    window.requestAnimationFrame(()=>reviewButtonRef.current?.focus());
    return;
   }
   if(event.key!=='Tab'||controls.length===0)return;
   const first=controls[0];
   const last=controls[controls.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',handleKey);
  return ()=>window.removeEventListener('keydown',handleKey);
 },[confirmOpen,pending]);

 const closeConfirmation=()=>{
  if(pending)return;
  setConfirmOpen(false);
  window.requestAnimationFrame(()=>reviewButtonRef.current?.focus());
 };

 return <section className="contest-voting" id="vote" aria-labelledby="vote-title">
  <div className="contest-vote-glow" aria-hidden="true"/>
  <div className="contest-vote-heading">
   <div><p className="eyebrow">House vote</p><h2 id="vote-title">Pick your <em>star.</em></h2><p className="contest-vote-intro">Every approved ticket carries one vote. Choose the contender you want to keep on the Spectra stage.</p><p className="contest-final-note">Your vote is final. If you have more than one approved ticket, you may use each remaining vote — including for the same contender.</p></div>
   <div className="contest-vote-summary" aria-live="polite"><span>{signedIn&&setupReady?`${remaining} ${remaining===1?'vote':'votes'} left`:'Live house vote'}</span><small>{signedIn&&ticketStatus?`${ticketStatus.used} used · ${ticketStatus.eligible} eligible`:totalVotes===null?'Results revealed by Spectra':`${totalVotes} ${totalVotes===1?'vote':'votes'} cast`}</small></div>
  </div>

  {!setupReady&&<div className="contest-setup-notice" role="status"><span aria-hidden="true">✦</span><div><strong>The house vote is being prepared.</strong><p>Meet the Top 21 in this preview. Ticket voting will appear here as soon as the ballot opens.</p></div></div>}
  {setupReady&&!votingOpen&&<div className="contest-setup-notice" role="status"><span aria-hidden="true">◇</span><div><strong>Voting is closed right now.</strong><p>The roster and results remain here while the house prepares the next voting window.</p></div></div>}
  {setupReady&&votingOpen&&!signedIn&&<div className="contest-access-note"><div><strong>Your ticket is your vote.</strong><p>Sign in to use the vote attached to each approved ticket.</p></div><a className="button" href="/login?next=/contest">Sign in to vote <span aria-hidden="true">↗</span></a></div>}
  {setupReady&&votingOpen&&signedIn&&remaining===0&&<div className="contest-access-note"><div><strong>{(ticketStatus?.used??0)>0?'Your ticket votes have been used.':'You need an approved ticket to vote.'}</strong><p>{(ticketStatus?.used??0)>0?'Thank you for taking part. Follow the live house tally below.':'Buy a ticket and upload your receipt. Once approved, its vote will appear here.'}</p></div><a className="button" href="/tickets">Get tickets <span aria-hidden="true">↗</span></a></div>}

  <div className="contest-ballot-layout">
   <div className="contestant-grid" role={canVote?'radiogroup':'list'} aria-label="Official contenders">
    {contestants.map(contestant=><VoteCard key={contestant.id} contestant={contestant} selected={contestant.id===selectedId} onSelect={()=>setSelectedId(contestant.id)} mode={cardMode}/>) }
   </div>
    <aside className="contest-leaderboard" aria-labelledby="leaderboard-title"><p className="eyebrow">Leaderboard</p><h3 id="leaderboard-title">Tonight’s rank</h3>{!visibleResults&&<p className="leaderboard-hidden">The tally will appear when Spectra reveals the results.</p>}<ol>{leaderboard.map((contestant,index)=><li key={contestant.id}><span className="leaderboard-position">{visibleResults?index+1:contestant.position??index+1}</span><img src={portrait(contestant)} alt="" loading="lazy"/><span className="leaderboard-name">{contestant.name}</span><strong>{contestant.vote_count??'—'}</strong></li>)}</ol></aside>
  </div>

  {canVote&&<div className="contest-selection-bar" aria-live="polite"><div><span>Your selection</span><strong>{selected?`${String(selected.number).padStart(2,'0')} · ${selected.name}`:'Choose one contender above'}</strong></div><button className="button" type="button" disabled={!selected||pending} onClick={()=>setConfirmOpen(true)} ref={reviewButtonRef}>Review vote <span aria-hidden="true">→</span></button></div>}

  {confirmOpen&&selected&&campaignId&&<div className="contest-dialog-backdrop"><div className="contest-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-vote-title" aria-describedby="confirm-vote-copy" ref={dialogRef}><button className="contest-dialog-close" type="button" onClick={closeConfirmation} disabled={pending} aria-label="Close vote confirmation">×</button><p className="eyebrow">Final check</p><div className="contest-confirm-person"><img src={portrait(selected)} alt=""/><span><small>Contender {String(selected.number).padStart(2,'0')}</small><strong id="confirm-vote-title">{selected.name}</strong></span></div><p id="confirm-vote-copy">Cast one of your ticket votes for this contender? Once recorded, this vote cannot be changed or moved.</p>{state.status==='error'&&state.contestantId===selected.id&&<p className="contest-vote-error" role="alert">{state.message}</p>}<form action={action}><input type="hidden" name="campaign_id" value={campaignId}/><input type="hidden" name="contestant_id" value={selected.id}/><button className="button" type="submit" disabled={pending}>{pending?'Recording your vote…':'Cast my final vote'}<span aria-hidden="true">↗</span></button><button className="contest-cancel-button" type="button" disabled={pending} onClick={closeConfirmation}>Go back</button></form></div></div>}
  {toast&&<div className="contest-toast" role="status"><span aria-hidden="true">✓</span><span>{toast}<small>{remaining} {remaining===1?'vote':'votes'} remaining.</small></span><button type="button" aria-label="Dismiss message" onClick={()=>setToast('')}>×</button></div>}
 </section>;
}
