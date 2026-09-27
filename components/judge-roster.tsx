'use client';

import {useEffect,useState} from 'react';
import {lowestScoredContestantIds,type LeaderboardRow,type ScoringRound} from '@/lib/tabulation';

type Contender={id:string;name:string;number:number;image_url:string;scored:boolean};

export default function JudgeRoster({campaignId,round,contenders,scoringOpen,initialLowestIds}:{campaignId:string;round:ScoringRound;contenders:Contender[];scoringOpen:boolean;initialLowestIds:string[]}){
 const [search,setSearch]=useState('');
 const [lowestIds,setLowestIds]=useState(()=>new Set(initialLowestIds));
 const term=search.trim().toLocaleLowerCase();
 const visible=contenders.filter(person=>person.name.toLocaleLowerCase().includes(term)||String(person.number).includes(term)||String(person.number).padStart(2,'0').includes(term));
 useEffect(()=>{
  let active=true;
  async function refresh(){
   if(document.visibilityState==='hidden')return;
   try{
    const response=await fetch(`/api/tabulation/results?campaign=${campaignId}&round=${round}`,{cache:'no-store'});
    if(!response.ok)return;
    const payload=await response.json() as {rows:LeaderboardRow[]};
    if(active)setLowestIds(lowestScoredContestantIds(payload.rows));
   }catch{}
  }
  const timer=window.setInterval(refresh,5000);
  return ()=>{active=false;window.clearInterval(timer);};
 },[campaignId,round]);

 return <section className="judge-roster-section" aria-label="Contestants to judge">
  <div className="judge-roster-toolbar">
   <div className="judge-roster-search">
    <label htmlFor="judge-contender-search">Find a contender</label>
    <div className="judge-roster-search-field"><span aria-hidden="true">⌕</span><input id="judge-contender-search" type="search" autoComplete="off" placeholder="Search by name or number" value={search} onChange={event=>setSearch(event.target.value)}/></div>
   </div>
   <p role="status" aria-live="polite">{term?`${visible.length} of ${contenders.length} contenders`:`${contenders.length} ${contenders.length===1?'contender':'contenders'}`}{lowestIds.size>0?' · lowest five marked':''}</p>
  </div>
  {visible.length>0?<div className="judge-roster">{visible.map(person=><article className="judge-person" key={person.id}>
   {person.image_url?<img src={person.image_url} alt="" loading="lazy"/>:<span className="judge-person-placeholder">{String(person.number).padStart(2,'0')}</span>}
   <div><small>Contestant {String(person.number).padStart(2,'0')}</small><h3>{person.name}</h3><span className={person.scored?'judge-done':'judge-pending'}>{person.scored?'Scorecard submitted':'Awaiting your score'}</span>{lowestIds.has(person.id)&&<span className="judge-lowest-badge">Lowest 5 overall</span>}</div>
   {scoringOpen&&<a className="button" href={`/judge/${campaignId}/${person.id}?round=${round}`}>{person.scored?'Edit score':'Score now'} ↗</a>}
  </article>)}</div>:<div className="notice judge-roster-empty">{contenders.length===0?'No contenders are available for this contest yet.':<>No contenders match “{search.trim()}”. <button type="button" onClick={()=>setSearch('')}>Clear search</button></>}</div>}
 </section>;
}
