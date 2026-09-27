'use client';

import {useDeferredValue,useState} from 'react';

type Candidate={id:string;name:string;number:number;previousTotal:number|null;previousJudges:number};

export default function RoundContestantSelector({candidates,initialSelection,locked,roundLabel,previousRoundLabel}:{candidates:Candidate[];initialSelection:string[];locked:boolean;roundLabel:string;previousRoundLabel?:string}){
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState(()=>new Set(initialSelection));
 const deferredSearch=useDeferredValue(search.trim().toLocaleLowerCase());
 const visible=candidates.filter(person=>person.name.toLocaleLowerCase().includes(deferredSearch)||String(person.number).padStart(2,'0').includes(deferredSearch));
 const visibleIds=visible.map(person=>person.id);
 const visibleSet=new Set(visibleIds);
 const toggle=(id:string,checked:boolean)=>setSelected(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const selectVisible=()=>setSelected(current=>new Set([...current,...visibleIds]));
 const clear=()=>setSelected(new Set());

 return <div className="round-selector">
  <div className="round-selector-toolbar">
   <label>Find a contestant<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name or number" autoComplete="off" disabled={locked}/></label>
   <div><span>{selected.size} selected</span><button type="button" onClick={selectVisible} disabled={locked||visibleIds.length===0}>Select shown</button><button type="button" onClick={clear} disabled={locked||selected.size===0}>Clear</button></div>
  </div>
  <div className="tabulation-advance-list">{candidates.map(person=>{
   return <label key={person.id} className="tabulation-advance-person" hidden={!visibleSet.has(person.id)}>
    <input type="checkbox" name="contestant_id" value={person.id} checked={selected.has(person.id)} disabled={locked} onChange={event=>toggle(person.id,event.target.checked)}/>
    <span><strong>{String(person.number).padStart(2,'0')} · {person.name}</strong><small>{previousRoundLabel&&person.previousTotal!==null?`${previousRoundLabel} · ${person.previousTotal.toFixed(2)} / 100 · ${person.previousJudges} ${person.previousJudges===1?'judge':'judges'}`:`Import to ${roundLabel}`}</small></span>
   </label>;
  })}</div>
  {visibleIds.length===0&&<p className="notice">No contestants match “{search.trim()}”.</p>}
 </div>;
}
