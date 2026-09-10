import {NextResponse,type NextRequest} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {safeNext,siteUrl} from '@/lib/customer';
export async function GET(request:NextRequest) {
 const params=request.nextUrl.searchParams;
 const db=await createClient();
 const token=params.get('token_hash');const code=params.get('code');
 const type=params.get('type');
 const result=token && type==='signup' ? await db.auth.verifyOtp({token_hash:token,type:'signup'}) : code ? await db.auth.exchangeCodeForSession(code) : {error:true};
 return NextResponse.redirect(new URL(result.error?'/login?error=confirmation':safeNext(params.get('next')),siteUrl()));
}
