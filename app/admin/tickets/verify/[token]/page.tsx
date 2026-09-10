import {UUID} from '@/lib/tickets';
import {notFound,redirect} from 'next/navigation';
export default async function LegacyScan({params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!UUID.test(token))notFound();
 redirect(`/staff/scan/${token}`);
}
