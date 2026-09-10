'use server';
import {createClient,isConfigured} from '@/lib/supabase/server';
import {ticketToken,type ScanResponse,type TicketScanResult} from '@/lib/scanner';
import {UUID} from '@/lib/tickets';
export async function scanTicket(input:{code:string;mode:string;eventId:string}):Promise<ScanResponse> {
 if(!input||typeof input.code!=='string'||typeof input.eventId!=='string'||!UUID.test(input.eventId)||!['entry','food'].includes(input.mode))return {error:'Choose an event and scan mode before scanning.'};
 const token=ticketToken(input.code);
 if(!token)return {error:'This is not a Spectra ticket QR. Scan a guest’s approved ticket.'};
 if(!isConfigured())return {error:'Ticket scanning is not configured yet.'};
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user)return {error:'Your session has ended. Sign in again before scanning.'};
 const {data:staff,error:roleError}=await db.rpc('is_ticket_staff');
 if(roleError)return {error:'Scanning is not ready. Ask the admin to apply the staff scanning database update.'};
 if(!staff)return {error:'Staff access is required. Ask your admin to assign your account.'};
 const {data,error}=await db.rpc('scan_ticket',{p_token:token,p_mode:input.mode,p_event_id:input.eventId});
 if(error||!data?.[0])return {error:'The scan could not be confirmed. Check your connection and scan again; do not accept it until confirmed.'};
 return {scan:data[0] as TicketScanResult};
}
