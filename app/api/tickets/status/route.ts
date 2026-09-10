import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/tickets';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};

export async function GET(request:NextRequest) {
 const raw=request.nextUrl.searchParams.get('orders')??'';
 const values=raw.split(',');
 if(!raw||raw.length>3700||values.length>100||values.some(id=>!UUID.test(id)))return NextResponse.json({error:'Provide between 1 and 100 valid booking IDs.'},{status:400,headers});
 try {
  const db=await createClient();
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user)return NextResponse.json({error:'Sign in to view ticket activity.'},{status:401,headers});
  // The signed-in client and issued_tickets RLS restrict this to the owner or an administrator.
  const {data,error}=await db.from('issued_tickets').select('id,order_id,seat_number,checked_in_at,food_redeemed_at').in('order_id',[...new Set(values)]).order('seat_number').limit(1000);
  if(error){
   const missingSetup=error.code==='42703'||error.code==='PGRST204'||error.message.includes('food_redeemed_at');
   return NextResponse.json({code:missingSetup?'SCAN_SETUP_REQUIRED':'STATUS_UNAVAILABLE',error:missingSetup?'The staff scanner database update is required.':'Ticket activity is temporarily unavailable.'},{status:503,headers});
  }
  const tickets=(data??[]).map(({id,order_id,seat_number,checked_in_at,food_redeemed_at})=>({id,order_id,seat_number,checked_in_at,food_redeemed_at}));
  return NextResponse.json({tickets},{headers});
 }catch{
  return NextResponse.json({code:'STATUS_UNAVAILABLE',error:'Ticket activity is temporarily unavailable.'},{status:503,headers});
 }
}
