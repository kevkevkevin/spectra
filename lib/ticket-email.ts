import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {siteUrl} from './customer';
import {eventDate,money,orderReference,type TicketOrder} from './tickets';

export function emailConfigured() {
 return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.ADMIN_NOTIFICATION_EMAIL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.SITE_URL);
}
// Privileged client is isolated to delivery of the transactionally recorded email queue.
export async function dispatchTicketEmails(orderId?:string) {
 if(!emailConfigured()) return {sent:0,failed:0,configured:false};
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, {auth:{persistSession:false,autoRefreshToken:false}});
 let query=db.from('ticket_notifications').select('id').neq('state','sent').lt('attempts',10).order('created_at').limit(20);
 if(orderId) query=query.eq('order_id',orderId);
 const {data,error}=await query;
 if(error) return {sent:0,failed:1,configured:true};
 let sent=0,failed=0;
 for(const pending of data??[]) {
  const {data:claimed,error:claimError}=await db.rpc('claim_ticket_email',{p_id:pending.id});
  const notification=claimed?.[0];
  if(claimError || !notification) continue;
  try {
   const {data:order,error:orderError}=await db.from('ticket_orders').select('*').eq('id',notification.order_id).single();
   if(orderError || !order) throw new Error('order_unavailable');
   const o=order as TicketOrder;
   const submitted=notification.kind==='submitted';
   const reference=orderReference(o.id);
   const recipient=submitted ? process.env.ADMIN_NOTIFICATION_EMAIL! : o.customer_email;
   const subject=submitted ? `Spectra: ticket request ${reference} awaiting review` : `Spectra: ticket request ${reference} ${notification.kind}`;
   const text=submitted
    ? `A ticket request is ready for review.\n\nReference: ${reference}\nEvent: ${o.event_title}\nDate: ${eventDate(o.event_starts_at)}\nQuantity: ${o.quantity}\nTotal: ${money(o.total_minor)}\n\nSign in to review the private receipt and approve or reject:\n${siteUrl()}/admin/tickets/${o.id}\n\nThis notification is not a payment verification.`
    : `Your ticket request ${reference} has been ${notification.kind}.\n\nEvent: ${o.event_title}\nDate: ${eventDate(o.event_starts_at)}\nQuantity: ${o.quantity}\nTotal: ${money(o.total_minor)}\n${o.review_note ? `\nMessage from Spectra: ${o.review_note}\n` : ''}\n${notification.kind==='approved' ? 'Your QR tickets are ready in your account.' : 'Open your account for details. Contact Spectra about a corrected submission or any payment already made.'}\n${siteUrl()}/account/orders/${o.id}`;
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`ticket-${notification.id}`},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[recipient],subject,text}),signal:AbortSignal.timeout(12000)});
   if(!response.ok) throw new Error(`provider_http_${response.status}`);
   const result=await response.json();
   if(typeof result.id!=='string') throw new Error('provider_response_invalid');
   const {error:saveError}=await db.from('ticket_notifications').update({state:'sent',sent_at:new Date().toISOString(),provider_id:result.id,last_error:null}).eq('id',notification.id);
   if(saveError) throw new Error('delivery_record_failed');
   sent++;
  } catch(error) {
   failed++;
   const code=error instanceof Error && /^[a-z_]+(?:_\d+)?$/.test(error.message) ? error.message : 'delivery_failed';
   await db.from('ticket_notifications').update({state:'failed',last_error:code}).eq('id',notification.id);
  }
 }
 return {sent,failed,configured:true};
}
