import {createClient,isConfigured} from '@/lib/supabase/server';
import {previewEvents,type TicketEvent,type PaymentSettings} from '@/lib/tickets';
import TicketPurchase from '@/components/ticket-purchase';
import AccountHeader from '@/components/account-header';
import {randomUUID} from 'node:crypto';
export const dynamic='force-dynamic';
export default async function Tickets() {
 const db=isConfigured()?await createClient():null;
 const [auth,eventResult,paymentResult,availability]=await Promise.all([db?.auth.getUser(),db?.from('ticket_events').select('*').order('created_at'),db?.from('ticket_payment_settings').select('*').eq('id',true).maybeSingle(),db?.rpc('ticket_availability')]);
 const available=new Map((availability?.data??[]).map((row:{event_id:string;remaining:number})=>[row.event_id,Number(row.remaining)]));
 const events=(eventResult?.data as TicketEvent[]|null)?.filter(event=>!event.deleted_at).map(event=>({...event,remaining:Number(available.get(event.id)??0)}));const user=auth?.data.user;
 return <><AccountHeader/><main className="ticket-shell"><p className="eyebrow">Tickets</p><h1>Buy a night.</h1><p className="ticket-intro">Choose a night, pay the total, then upload the receipt. When the house approves, your tickets with QR codes appear in <a href="/account">your account.</a></p>{eventResult?.error&&<p className="notice">Ticket booking is being prepared. Event details below are a preview; payments are not being accepted yet.</p>}{events?.length===0?<p className="notice">No events are available yet. Check back soon.</p>:<TicketPurchase events={events??previewEvents} payment={paymentResult?.data as PaymentSettings|null??null} signedIn={Boolean(user)} orderId={randomUUID()} name={typeof user?.user_metadata?.display_name==='string'?user.user_metadata.display_name:''}/>}</main></>;
}
