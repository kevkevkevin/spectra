import StaffScanPage from '@/components/staff-scan-page';
import {UUID} from '@/lib/tickets';
import {notFound} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function ScanLink({params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!UUID.test(token))notFound();
 return <StaffScanPage token={token}/>;
}
