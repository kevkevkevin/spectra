import {NextRequest,NextResponse} from 'next/server';
import {createClient as createAnonymousClient} from '@supabase/supabase-js';
import {createClient,isConfigured} from '@/lib/supabase/server';
import {UUID} from '@/lib/tickets';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const campaign=request.nextUrl.searchParams.get('campaign')??'';
 if(!UUID.test(campaign))return NextResponse.json({error:'Invalid campaign'},{status:400,headers:{'Cache-Control':'no-store'}});
 if(!isConfigured())return NextResponse.json({error:'Scoring is not configured'},{status:503,headers:{'Cache-Control':'no-store'}});
 const publicView=request.nextUrl.searchParams.get('public')==='1';
 const db=publicView
  ?createAnonymousClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  :await createClient();
 const {data,error}=await db.rpc('contest_judge_leaderboard',{p_campaign_id:campaign});
 if(error)return NextResponse.json({error:'Results unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
 return NextResponse.json({rows:data??[]},{headers:{'Cache-Control':'no-store'}});
}
