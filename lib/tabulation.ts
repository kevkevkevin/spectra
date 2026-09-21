export type CriterionCategory='voice'|'stage'|'audience';
export type ScoringCriterion={id:string;campaign_id:string;category:CriterionCategory;name:string;weight:number;position:number};
export type ScoringSettings={campaign_id:string;scoring_open:boolean;results_visible:boolean};
export type LeaderboardRow={contestant_id:string;number:number;name:string;judge_count:number;voice_points:number|null;stage_points:number|null;audience_points:number|null;total_points:number|null;rank_position:number|null};
export const categoryDetails={
 voice:{label:'Voice quality',weight:50},
 stage:{label:'Stage presence',weight:30},
 audience:{label:'Audience impact',weight:20},
} as const;
export const categories=['voice','stage','audience'] as const;
export function points(value:number,weight:number){return value*weight/10;}
export function formattedPoints(value:number|null){return value===null?'—':Number(value).toFixed(2);}
