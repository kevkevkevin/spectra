import {createClient,isConfigured} from './supabase/server';
import {redirect} from 'next/navigation';
import {safeNext} from './customer';
export async function requireAdmin(next='/admin'){
 if(!isConfigured()) redirect('/login?error=setup');
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
 const {data}=await db.from('admins').select('user_id').eq('user_id',user.id).maybeSingle();
 return {db,user,isAdmin:Boolean(data)};
}
