'use server';
import {createClient,isConfigured} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {safeNext} from '@/lib/customer';
export async function login(form:FormData){
  const next=safeNext(form.get('next'));
  if(!isConfigured()) redirect('/login?error=setup');
  const email=String(form.get('email')??'').trim();
  const password=String(form.get('password')??'');
  if(!email || !password || email.length>254 || password.length>1024) redirect('/login?error=credentials');
  const db=await createClient();
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) redirect(`/login?error=credentials&next=${encodeURIComponent(next)}`);
  if(next==='/account') {
    const {data:{user}}=await db.auth.getUser();
    const {data}=await db.from('admins').select('user_id').eq('user_id',user!.id).maybeSingle();
    if(data) redirect('/admin/tickets');
  }
  redirect(next);
}
export async function logout(){const db=await createClient();await db.auth.signOut();redirect('/login');}
