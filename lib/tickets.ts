export type TicketEvent = { id:string; title:string; description:string; venue:string; starts_at:string|null; price_minor:number; capacity:number; active:boolean; remaining?:number; banner_url?:string; deleted_at?:string|null };
export type PaymentSettings = { payee:string; stc_pay:string; bank_name:string; iban:string; instructions:string; enabled:boolean };
export type TicketOrder = { id:string; user_id:string; event_id:string; customer_name:string; customer_email:string; customer_phone:string; event_title:string; event_venue:string; event_starts_at:string|null; quantity:number; unit_price_minor:number; total_minor:number; receipt_path:string; note:string; status:'pending'|'approved'|'rejected'; review_note:string; reviewed_at:string|null; created_at:string };
export type IssuedTicket = {id:string;order_id:string;seat_number:number;token:string;checked_in_at:string|null;food_redeemed_at:string|null};
export const money = (minor:number) => `${(minor/100).toLocaleString('en-SA',{maximumFractionDigits:2})} SAR`;
export const eventDate = (date:string|null) => date ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(date))+' · Saudi time' : 'Date to be announced';
export const orderReference = (id:string) => id.slice(0,8).toUpperCase();
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const previewEvents:TicketEvent[] = [
 {id:'10000000-0000-4000-8000-000000000001',title:'Spectra Live Night',description:'An evening with the house — live voices, lights, and the Spectra stage.',venue:'Bora Cafe, Ground Floor, Jeddah',price_minor:5000,capacity:100,active:false,starts_at:null},
 {id:'10000000-0000-4000-8000-000000000002',title:'Spectra’s Next Singing Idol',description:'A seat for a night of extraordinary voices on the Spectra stage.',venue:'Bora Cafe, Ground Floor, Jeddah',price_minor:7500,capacity:100,active:false,starts_at:null},
];
