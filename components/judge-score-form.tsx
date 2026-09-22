'use client';
import {useState} from 'react';
import SubmitButton from '@/components/submit-button';
import {submitJudgeScorecard} from '@/app/judge/actions';
import {categories,categoryDetails,formattedPoints,points,type ScoringCriterion,type ScoringRound} from '@/lib/tabulation';

function validScore(raw:string){
 if(raw.trim()==='')return null;
 const value=Number(raw);
 return Number.isFinite(value)&&value>=0&&value<=10&&Math.abs(Math.round(value*100)-value*100)<1e-7?value:null;
}

export default function JudgeScoreForm({campaignId,contestantId,round,criteria,previous}:{campaignId:string;contestantId:string;round:ScoringRound;criteria:ScoringCriterion[];previous:Record<string,number>}){
 const [scores,setScores]=useState<Record<string,string>>(Object.fromEntries(criteria.map(item=>[item.id,String(previous[item.id]??'')])));
 const updateScore=(id:string,value:string)=>setScores(current=>current[id]===value?current:{...current,[id]:value});
 const rated=criteria.filter(item=>validScore(scores[item.id]??'')!==null).length;
 const subtotal=(category:ScoringCriterion['category'])=>criteria.filter(item=>item.category===category).reduce((sum,item)=>{
  const score=validScore(scores[item.id]??'');
  return sum+(score===null?0:points(score,item.weight));
 },0);
 const total=categories.reduce((sum,category)=>sum+subtotal(category),0);

 return <form action={submitJudgeScorecard} className="judge-score-form">
  <input type="hidden" name="campaign_id" value={campaignId}/><input type="hidden" name="contestant_id" value={contestantId}/><input type="hidden" name="round" value={round}/>
  <div className="judge-score-layout">
   <aside className="judge-score-preview" aria-label="Live score preview">
    <p className="eyebrow">Live score preview</p>
    <div className="judge-preview-total" role="status" aria-live="polite"><span>Weighted score</span><strong>{formattedPoints(total)} <small>/ 100</small></strong></div>
    <p className="judge-preview-progress">{rated} of {criteria.length} criteria rated{rated<criteria.length?' · preview is incomplete':''}</p>
    <dl className="judge-preview-breakdown">{categories.map(category=><div key={category}><dt>{categoryDetails[category].label}</dt><dd>{formattedPoints(subtotal(category))} <small>/ {categoryDetails[category].weight}</small></dd></div>)}</dl>
    <p className="judge-preview-note">Scores update as you type. Only entries from 0–10 with up to two decimal places count in this preview.</p>
   </aside>
   <div className="judge-score-fields">
    {categories.map(category=><fieldset className="judge-category" key={category}>
     <legend><span>{categoryDetails[category].label}</span><strong>{categoryDetails[category].weight}%</strong></legend>
     <div className="judge-criterion-list">{criteria.filter(item=>item.category===category).map(item=><label className="judge-criterion" key={item.id}>
      <span><strong>{item.name}</strong><small>{item.weight}% of the final score · rate 0–10</small></span>
      <input type="number" name={`score_${item.id}`} min={0} max={10} step=".01" required inputMode="decimal" value={scores[item.id]??''}
       onInput={event=>updateScore(item.id,event.currentTarget.value)} onChange={event=>updateScore(item.id,event.currentTarget.value)}
       onKeyUp={event=>updateScore(item.id,event.currentTarget.value)} onBlur={event=>updateScore(item.id,event.currentTarget.value)}/>
     </label>)}</div>
     <div className="judge-subtotal"><span>Weighted category score</span><strong>{formattedPoints(subtotal(category))} / {categoryDetails[category].weight}</strong></div>
    </fieldset>)}
    <p className="form-hint">The saved scorecard can be revised while scoring is open. Every criterion must have a score.</p>
    <SubmitButton pending="Saving scorecard…">Submit scorecard ↗</SubmitButton>
   </div>
  </div>
 </form>;
}
