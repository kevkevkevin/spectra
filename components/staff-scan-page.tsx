import {requireCustomer} from '@/lib/customer';
import AccountHeader from './account-header';
import TicketScanner from './ticket-scanner';
import type {ScanEvent} from '@/lib/scanner';
export default async function StaffScanPage({token}:{token?:string}) {
 const {db}=await requireCustomer(token?`/staff/scan/${token}`:'/staff/scan');
 const {data:staff,error}=await db.rpc('is_ticket_staff');
 if(error||!staff)return <><AccountHeader/><main className="ticket-shell verify-shell"><p className="eyebrow">Spectra staff</p><h1>{error?'Scanner setup.':'Staff access required.'}</h1><p className="notice">{error?'Apply 004_staff_scanning.sql in Supabase to enable the scanner and staff roles.':'Ask an admin to assign Staff to your account. Your own tickets are available in My account.'}</p><a className="button" href="/account">My account ↗</a></main></>;
 const {data:events,error:eventsError}=await db.rpc('list_scannable_ticket_events');
 return <><AccountHeader/><main className="ticket-shell scanner-shell"><p className="eyebrow">Spectra · Staff desk</p><div className="ticket-title-row"><h1>Welcome them in.</h1><span className="status-badge approved">Staff access</span></div><p className="ticket-intro">Choose your event and counter. Scan each guest’s QR for entry, then use the same ticket at the food counter.</p>{eventsError?<p role="alert">Events could not be loaded. Refresh and check the scanner database setup.</p>:<TicketScanner events={(events??[]) as ScanEvent[]} initialToken={token}/>}</main></>;
}
