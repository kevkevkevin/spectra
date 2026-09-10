import {requireCustomer} from '@/lib/customer';
import {eventDate,money,orderReference,type TicketOrder} from '@/lib/tickets';
import AccountHeader from '@/components/account-header';
import OrderRefresh from '@/components/order-refresh';
import TicketScanStatus,{type ScanTicket} from '@/components/ticket-scan-status';
export const dynamic='force-dynamic';
export default async function Account() {
 const {db,user}=await requireCustomer();
 const {data,error}=await db.from('ticket_orders').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);
 const orders=(data??[]) as TicketOrder[];
 const {data:ticketData,error:scanError}=orders.length?await db.from('issued_tickets').select('id,order_id,seat_number,checked_in_at,food_redeemed_at').in('order_id',orders.map(order=>order.id)).order('seat_number').limit(1000):{data:[],error:null};
 return <><AccountHeader/><main className="ticket-shell"><p className="eyebrow">Your account</p><div className="ticket-title-row"><h1>Your nights.</h1><a className="button" href="/tickets">Book a night ↗</a></div><p className="muted">{user.email}</p><div className="status-toolbar"><p>Track your requests and find your approved QR tickets here.</p><OrderRefresh poll={orders.some(o=>o.status==='pending')}/></div>{error?<p role="alert">We couldn’t load your orders. Please refresh or contact Spectra.</p>:orders.length===0?<div className="empty-state"><h2>Your stage is waiting.</h2><p>You haven’t requested any tickets yet.</p><a className="button" href="/tickets">Explore tickets ↗</a></div>:<div className="order-list">{orders.map(order=><a className="order-card" href={`/account/orders/${order.id}`} key={order.id}><div><span className={`status-badge ${order.status}`}>{order.status==='pending'?'Awaiting approval':order.status}</span><h2>{order.event_title}</h2><p>{eventDate(order.event_starts_at)}</p><small>#{orderReference(order.id)} · {order.quantity} {order.quantity===1?'ticket':'tickets'}</small></div><div className="order-card-total"><strong>{money(order.total_minor)}</strong><span>View details ↗</span></div></a>)}</div>}<TicketScanStatus orderIds={orders.map(order=>order.id)} initialTickets={(ticketData??[]) as ScanTicket[]} initialError={scanError?(scanError.message.includes("food_redeemed_at")?"Entry and food tracking needs database update 004. Ask the site administrator to complete setup.":"Ticket activity is temporarily unavailable. We’ll keep trying."):undefined} orders={orders.map(order=>({id:order.id,title:order.event_title,quantity:order.quantity}))} compact/></main></>;
}
