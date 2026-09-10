import {NextResponse,type NextRequest} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {dispatchTicketEmails} from '@/lib/ticket-email';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
 const expected=process.env.NOTIFICATION_CRON_SECRET;
 const provided=request.headers.get('authorization')??'';
 const suppliedBytes=Buffer.from(provided);const expectedBytes=Buffer.from(`Bearer ${expected??''}`);
 if(!expected || suppliedBytes.length!==expectedBytes.length || !timingSafeEqual(suppliedBytes,expectedBytes)) return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json(await dispatchTicketEmails());}catch{return NextResponse.json({error:'Delivery retry failed'},{status:503});}
}
