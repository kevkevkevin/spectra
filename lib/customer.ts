import { createClient,isConfigured } from './supabase/server';
import { redirect } from 'next/navigation';
export function safeNext(value:unknown) {
 const path=String(value??'');
 return /^\/(account|tickets|contest|admin|staff|judge)(\/[^?#\\]*)?$/.test(path) ? path : '/account';
}
export function siteUrl() {
 const value=process.env.SITE_URL || (process.env.NODE_ENV==='production'?'':'http://localhost:3000');
 if(!value) throw new Error('SITE_URL is required in production');
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)) throw new Error('Invalid SITE_URL');
 return url.origin;
}
export async function requireCustomer(next='/account') {
 if(!isConfigured()) redirect('/login?error=setup');
 const db=await createClient();
 const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
 return {db,user};
}
