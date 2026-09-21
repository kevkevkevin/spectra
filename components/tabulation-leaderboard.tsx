'use client';
import {useEffect,useState} from 'react';
import {formattedPoints,type LeaderboardRow} from '@/lib/tabulation';

export default function TabulationLeaderboard({campaignId,initialRows,publicView=false}:{campaignId:string;initialRows:LeaderboardRow[];publicView?:boolean}){
 const [rows,setRows]=useState(initialRows);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let active=true;
  async function refresh(){
   if(document.visibilityState==='hidden')return;
   try{
    const response=await fetch(`/api/tabulation/results?campaign=${campaignId}${publicView?'&public=1':''}`,{cache:'no-store'});
    if(!response.ok)throw new Error('Results unavailable');
    const payload=await response.json() as {rows:LeaderboardRow[]};
    if(active){setRows(payload.rows);setError(false);}
   }catch{if(active)setError(true);}
  }
  const timer=window.setInterval(refresh,5000);
  return ()=>{active=false;window.clearInterval(timer);};
 },[campaignId,publicView]);
 return <div className="tabulation-results">
  <div className="tabulation-results-heading"><div><p className="eyebrow">Live tabulation</p><h2>{publicView?'Judge results':'Current standings'}</h2></div><span className="tabulation-live-dot">Updates every 5 seconds</span></div>
  {error&&<p className="notice" role="status">Connection interrupted. Showing the latest available results.</p>}
  {rows.length===0?<p className="notice">{publicView?'Judge results are not public yet.':'No contestants to score yet.'}</p>:<div className="tabulation-table-wrap"><table className="tabulation-table">
   <thead><tr><th scope="col">Rank</th><th scope="col">Contestant</th><th scope="col">Voice / 50</th><th scope="col">Stage / 30</th><th scope="col">Impact / 20</th><th scope="col">Judges</th><th scope="col">Total / 100</th></tr></thead>
   <tbody>{rows.map(item=><tr key={item.contestant_id}><td>{item.rank_position??'—'}</td><td><span className="tabulation-contestant-number">{String(item.number).padStart(2,'0')}</span>{item.name}</td><td>{formattedPoints(item.voice_points)}</td><td>{formattedPoints(item.stage_points)}</td><td>{formattedPoints(item.audience_points)}</td><td>{item.judge_count}</td><td className="tabulation-total-cell">{formattedPoints(item.total_points)}</td></tr>)}</tbody>
  </table></div>}
  <p className="tabulation-rule-note">Each judge rates seven criteria from 0–10. Subcriterion points = rating ÷ 10 × weight. Each contestant’s displayed total is the average of completed judge scorecards. Partial judging is provisional. Ties are ordered by voice, then stage, then impact.</p>
 </div>;
}
