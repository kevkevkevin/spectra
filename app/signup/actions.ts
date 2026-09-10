'use server';
import {createClient,isConfigured} from '@/lib/supabase/server';
import {safeNext,siteUrl} from '@/lib/customer';
import {redirect} from 'next/navigation';
export async function signup(form:FormData) {
 const next=safeNext(form.get('next'));
 const email=String(form.get('email')??'').trim();
 const password=String(form.get('password')??'');
 const confirmation=String(form.get('password_confirmation')??'');
 const name=String(form.get('name')??'').trim();
 if(!isConfigured()) redirect('/signup?error=setup');
 if(password!==confirmation) redirect(`/signup?error=password&next=${encodeURIComponent(next)}`);
 if(!name || name.length>120 || !email || email.length>254 || password.length<10 || password.length>1024) redirect(`/signup?error=invalid&next=${encodeURIComponent(next)}`);
 const db=await createClient();
 const {data,error}=await db.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:`${siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`}});
 if(error) redirect(`/signup?error=signup&next=${encodeURIComponent(next)}`);
 if(data.session) redirect(next);
 redirect(`/signup?sent=1&next=${encodeURIComponent(next)}`);
}
