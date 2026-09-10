import {UUID} from './tickets';
export type ScanMode = 'entry' | 'food';
export type ScanEvent = {id:string;title:string;starts_at:string|null};
export type TicketScanResult = {
 result:'success'|'already_used'|'entry_required'|'invalid_ticket'|'wrong_event';
 ticket_id:string|null;event_title:string|null;guest_name:string|null;seat_number:number|null;
 checked_in_at:string|null;food_redeemed_at:string|null;
};
export type ScanResponse = {error?:string;scan?:TicketScanResult};
// Read only the supported ticket formats; never navigate to QR content.
export function ticketToken(value:string):string|null {
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))return null;
 const text=value.trim();
 if(text.length>600)return null;
 if(UUID.test(text))return text.toLowerCase();
 try {
  const url=new URL(text);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return null;
  const match=url.pathname.match(/^\/(?:staff\/scan|admin\/tickets\/verify)\/([^/]+)\/?$/);
  return match&&UUID.test(match[1])?match[1].toLowerCase():null;
 }catch{return null;}
}
