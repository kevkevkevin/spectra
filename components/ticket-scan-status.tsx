'use client';

import {useEffect,useRef,useState} from 'react';
import {eventDate,orderReference} from '@/lib/tickets';

export type ScanTicket = {
 id:string;
 order_id:string;
 seat_number:number;
 checked_in_at:string|null;
 food_redeemed_at:string|null;
};
type ScanOrder = {id:string;title:string;quantity:number};
type ScanNotice = {id:string;kind:'entry'|'food';seat:number;orderId:string;at:string};
type Props = {
 orderIds:string[];
 initialTickets:ScanTicket[];
 initialError?:string;
 orders:ScanOrder[];
 qrImages?:Record<string,string>;
 audience?:'guest'|'admin';
 compact?:boolean;
};

export const scanSetupMessage='Entry and food tracking needs the staff scanner database update (004). Ask the site administrator to complete setup.';

function validTicket(value:unknown):value is ScanTicket {
 if(!value||typeof value!=='object')return false;
 const ticket=value as Record<string,unknown>;
 return typeof ticket.id==='string'&&typeof ticket.order_id==='string'&&Number.isInteger(ticket.seat_number)
  &&(ticket.checked_in_at===null||typeof ticket.checked_in_at==='string')
  &&(ticket.food_redeemed_at===null||typeof ticket.food_redeemed_at==='string');
}

export default function TicketScanStatus({orderIds,initialTickets,initialError,orders,qrImages,audience='guest',compact=false}:Props) {
 const [tickets,setTickets]=useState(initialTickets);
 const [error,setError]=useState(initialError??'');
 const [notices,setNotices]=useState<ScanNotice[]>([]);
 const known=useRef(new Map(initialTickets.map(ticket=>[ticket.id,ticket])));
 const orderKey=[...new Set(orderIds)].sort().join(',');

 useEffect(()=>{
  if(!orderKey)return;
  let disposed=false;
  let inFlight=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  const refresh=async()=>{
   if(disposed||inFlight||document.visibilityState!=='visible')return;
   if(timer)clearTimeout(timer);
   inFlight=true;
   controller=new AbortController();
   let timedOut=false;
   const timeout=setTimeout(()=>{timedOut=true;controller?.abort();},10000);
   try {
    const response=await fetch(`/api/tickets/status?orders=${encodeURIComponent(orderKey)}`,{cache:'no-store',signal:controller.signal});
    const result=await response.json();
    if(disposed)return;
    if(!response.ok)throw new Error(response.status===401?'Your session has expired. Sign in again to see live ticket activity.':result.code==='SCAN_SETUP_REQUIRED'?scanSetupMessage:'Live ticket status is temporarily unavailable. We’ll keep trying.');
    if(!Array.isArray(result.tickets)||!result.tickets.every(validTicket))throw new Error('Live ticket status is temporarily unavailable. We’ll keep trying.');
    const latest=result.tickets as ScanTicket[];
    const fresh:ScanNotice[]=[];
    for(const ticket of latest){
     const previous=known.current.get(ticket.id);
     // A newly issued ticket establishes its own baseline; old scans never trigger a welcome popup.
     if(previous){
      if(previous.checked_in_at===null&&ticket.checked_in_at)fresh.push({id:`${ticket.id}:entry:${ticket.checked_in_at}`,kind:'entry',seat:ticket.seat_number,orderId:ticket.order_id,at:ticket.checked_in_at});
      if(previous.food_redeemed_at===null&&ticket.food_redeemed_at)fresh.push({id:`${ticket.id}:food:${ticket.food_redeemed_at}`,kind:'food',seat:ticket.seat_number,orderId:ticket.order_id,at:ticket.food_redeemed_at});
     }
    }
    known.current=new Map(latest.map(ticket=>[ticket.id,ticket]));
    setTickets(latest);
    setError('');
    if(fresh.length)setNotices(current=>[...current,...fresh]);
   }catch(cause){
    if(!disposed&&(timedOut||!(cause instanceof DOMException&&cause.name==='AbortError')))setError(timedOut?'Live ticket updates timed out. We’ll keep trying.':cause instanceof Error?cause.message:'Live ticket status is temporarily unavailable. We’ll keep trying.');
   }finally{
    clearTimeout(timeout);
    inFlight=false;
    if(!disposed&&document.visibilityState==='visible')timer=setTimeout(refresh,3000);
   }
  };
  const onVisibility=()=>{
   if(timer)clearTimeout(timer);
   if(document.visibilityState==='visible')void refresh();
  };
  document.addEventListener('visibilitychange',onVisibility);
  void refresh();
  return()=>{disposed=true;if(timer)clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',onVisibility);};
 },[orderKey]);

 if(!orderIds.length)return null;
 const showTicketList=tickets.length>0;
 return <section className={`ticket-scan-section${compact?' scan-compact':''}`} aria-label="Ticket entry and food status">
  <div className="scan-section-heading"><div><p className="eyebrow">From the gate to the counter</p><h2>{qrImages?'Your tickets':audience==='admin'?'Ticket activity':'Entry & food'}</h2></div><p className={`scan-live${error?' scan-live-offline':''}`}><span aria-hidden="true"/>{error?'Updates unavailable':'Live · Every 3 seconds'}</p></div>
  <p className="scan-section-intro">{audience==='admin'?'Entry check-in and food collection appear here as staff scan each ticket.':'Use the same QR at the entrance and the food counter. Keep this page open to receive your scan confirmation.'}</p>
  {error&&<p className="scan-connection-notice" role="status">{error}</p>}
  {showTicketList?<div className={compact?'scan-order-list':'issued-grid'}>{compact?orders.filter(order=>tickets.some(ticket=>ticket.order_id===order.id)).map(order=>{
   const group=tickets.filter(ticket=>ticket.order_id===order.id);
   return <article className="scan-order-summary" key={order.id}><div><h3>{order.title}</h3><a className="text-link" href={`/account/orders/${order.id}`}>Booking #{orderReference(order.id)} · View QR tickets ↗</a></div><div className="scan-summary-counts"><span><strong>{group.filter(ticket=>Boolean(ticket.checked_in_at)).length}/{order.quantity}</strong> checked in</span><span><strong>{group.filter(ticket=>Boolean(ticket.food_redeemed_at)).length}/{order.quantity}</strong> food collected</span></div></article>;
  }):tickets.map(ticket=>{
   const order=orders.find(item=>item.id===ticket.order_id);
   const qr=qrImages?.[ticket.id];
   return <article className={qr?'issued-ticket scan-qr-ticket':'scan-status-card'} key={ticket.id}>
    <p className="eyebrow">Spectra · {qr?'Admit one':'Ticket activity'}</p><h3>{order?.title??'Spectra'}</h3>
    {qr&&<img src={qr} alt={`Entry and food QR for ticket ${ticket.seat_number}`} width={260} height={260}/>}
    <strong>Ticket {ticket.seat_number}{order?` of ${order.quantity}`:''}</strong>
    <div className="scan-ticket-states"><ScanState label="Event entry" at={ticket.checked_in_at} waiting="Ready for entry" done="Checked in"/><ScanState label="Food collection" at={ticket.food_redeemed_at} waiting="Not collected" done="Food collected"/></div>
    <small>Booking #{orderReference(ticket.order_id)}</small>
   </article>;
  })}</div>:!error&&<p className="scan-empty">Entry and food statuses will appear here when your tickets are approved.</p>}
  <div className="scan-toast-stack" aria-live="polite" aria-atomic="false">{notices.slice(0,3).map(notice=><div className="scan-success-toast" role="status" key={notice.id}><span className="scan-toast-check" aria-hidden="true">✓</span><div><strong>{notice.kind==='entry'?'Check-in successful':'Food collection confirmed'}</strong><p>{orders.find(order=>order.id===notice.orderId)?.title??'Spectra'} · Ticket {notice.seat}</p><small>{eventDate(notice.at)}</small></div><button type="button" onClick={()=>setNotices(current=>current.filter(item=>item.id!==notice.id))} aria-label={`Dismiss ${notice.kind==='entry'?'check-in':'food collection'} confirmation for ticket ${notice.seat}`}>×</button></div>)}</div>
 </section>;
}

function ScanState({label,at,waiting,done}:{label:string;at:string|null;waiting:string;done:string}) {
 return <div className={`scan-ticket-state${at?' is-complete':''}`}><span className="scan-state-icon" aria-hidden="true">{at?'✓':'○'}</span><div><span>{label}</span><strong>{at?done:waiting}</strong>{at&&<time dateTime={at}>{eventDate(at)}</time>}</div></div>;
}
