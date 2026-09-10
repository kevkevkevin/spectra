'use server';

import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import {UUID} from '@/lib/tickets';

export async function setStaffAccess(form:FormData) {
 const {db,isAdmin}=await requireAdmin('/admin/staff');
 if(!isAdmin)redirect('/account');
 const userId=String(form.get('user_id')??'');
 const nextRole=String(form.get('staff')??'');
 const search=String(form.get('search')??'').trim().slice(0,100);
 const params=new URLSearchParams(search?{search}:{});
 if(!UUID.test(userId)||!['true','false'].includes(nextRole)) {
  params.set('error','invalid');
  redirect(`/admin/staff?${params}`);
 }
 const {error}=await db.rpc('set_ticket_staff',{p_user_id:userId,p_staff:nextRole==='true'});
 if(error) {
  params.set('error',['PGRST202','42883'].includes(error.code)?'setup':'save');
  redirect(`/admin/staff?${params}`);
 }
 revalidatePath('/admin/staff');
 revalidatePath('/account');
 revalidatePath('/staff/scan');
 params.set('saved',nextRole==='true'?'added':'removed');
 redirect(`/admin/staff?${params}`);
}
