'use client';
import {useState} from 'react';
import SubmitButton from '@/components/submit-button';
import {submitJudgeScorecard} from '@/app/judge/actions';
import {categories,categoryDetails,formattedPoints,points,type ScoringCriterion} from '@/lib/tabulation';

export default function JudgeScoreForm({campaignId,contestantId,criteria,previous}:{campaignId:string;contestantId:string;criteria:ScoringCriterion[];previous:Record<string,number>}){
 const [scores,setScores]=useState<Record<string,string>>(Object.fromEntries(criteria.map(item=>[item.id,String(previous[item.id]??'')])));
 const subtotal=(category:ScoringCriterion['category'])=>criteria.filter(item=>item.category===category).reduce((sum,item)=>sum+points(Number(scores[item.id]||0),item.weight),0);
 const total=categories.reduce((sum,category)=>sum+subtotal(category),0);
 return <form action={submitJudgeScorecard} className="judge-score-form">
  <input type="hidden" name="campaign_id" value={campaignId}/><input type="hidden" name="contestant_id" value={contestantId}/>
  {categories.map(category=><fieldset className="judge-category" key={category}>
   <legend><span>{categoryDetails[category].label}</span><strong>{categoryDetails[category].weight}%</strong></legend>
   <div className="judge-criterion-list">{criteria.filter(item=>item.category===category).map(item=><label className="judge-criterion" key={item.id}>
    <span><strong>{item.name}</strong><small>{item.weight}% of the final score · rate 0–10</small></span>
    <input type="number" name={`score_${item.id}`} min={0} max={10} step=".01" required inputMode="decimal" value={scores[item.id]} onChange={event=>setScores({...scores,[item.id]:event.target.value})}/>
   </label>)}</div>
   <div className="judge-subtotal"><span>Weighted category score</span><strong>{formattedPoints(subtotal(category))} / {categoryDetails[category].weight}</strong></div>
  </fieldset>)}
  <div className="judge-total"><span>Preview · total weighted score</span><strong>{formattedPoints(total)} <small>/ 100</small></strong></div>
  <p className="form-hint">The saved scorecard can be revised while scoring is open. Every criterion must have a score.</p>
  <SubmitButton pending="Saving scorecard…">Submit scorecard ↗</SubmitButton>
 </form>;
}
