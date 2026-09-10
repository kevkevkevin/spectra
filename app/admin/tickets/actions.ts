'use server';
import {requireAdmin} from '@/lib/admin';
import {UUID} from '@/lib/tickets';
import {dispatchTicketEmails} from '@/lib/ticket-email';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {randomUUID} from 'node:crypto';
async function staff(){const auth=await requireAdmin();if(!auth.isAdmin)redirect('/account');return auth;}
export async function reviewTicket(form:FormData) {
 const {db}=await staff();const id=String(form.get('id')??'');const decision=String(form.get('decision')??'');const note=String(form.get('review_note')??'').trim();
 if(!UUID.test(id))redirect('/admin/tickets?error=invalid');
 if(!['approved','rejected'].includes(decision)||note.length>1500||(decision==='rejected'&&!note))redirect(`/admin/tickets/${id}?error=reason`);
 if(decision==='approved'&&form.get('payment_checked')!=='on')redirect(`/admin/tickets/${id}?error=payment`);
 const {error}=await db.rpc('review_ticket_order',{p_id:id,p_decision:decision,p_note:note});
 if(error)redirect(`/admin/tickets/${id}?error=review`);
 try{await dispatchTicketEmails(id);}catch{ /* Retryable email queue preserves the decision. */ }
 revalidatePath('/admin/tickets');revalidatePath('/account');revalidatePath(`/account/orders/${id}`);
 redirect(`/admin/tickets/${id}?saved=1`);
}
export async function retryTicketEmails(form:FormData) {
 const {db}=await staff();const id=String(form.get('id')??'');
 const target=UUID.test(id)?`/admin/tickets/${id}`:'/admin/tickets';
 const {error:requeueError}=await db.rpc('requeue_ticket_emails',{p_order_id:UUID.test(id)?id:null});
 if(requeueError)redirect(`${target}?error=email`);
 let result;try{result=await dispatchTicketEmails(UUID.test(id)?id:undefined);}catch{redirect(`${target}?error=email`);}
 revalidatePath(target);redirect(`${target}?${!result.configured?'error=emailsetup':result.failed?'error=email':'emails=1'}`);
}
export async function checkIn(form:FormData) {
 const {db}=await staff();const token=String(form.get('token')??'');
 if(!UUID.test(token))redirect('/admin/tickets');
 const {data,error}=await db.rpc('check_in_ticket',{p_token:token});
 revalidatePath(`/admin/tickets/verify/${token}`);
 redirect(`/admin/tickets/verify/${token}?${error?'error=checkin':data?'saved=1':'used=1'}`);
}
export async function saveTicketEvent(form:FormData) {
 const {db}=await staff();const id=String(form.get('id')??'');
 const price=Number(form.get('price'));const capacity=Number(form.get('capacity'));
 const starts=String(form.get('starts_at')??'');const active=form.get('active')==='on';
 const title=String(form.get('title')??'').trim();const venue=String(form.get('venue')??'').trim();const description=String(form.get('description')??'').trim();
 const date=starts?new Date(`${starts}:00+03:00`):null;
 if((id&&!UUID.test(id))||!title||title.length>150||!venue||venue.length>250||description.length>1500||!Number.isFinite(price)||price<1||price>100000||Math.abs(price*100-Math.round(price*100))>0.0001||!Number.isInteger(capacity)||capacity<1||capacity>100000||(date&&Number.isNaN(date.getTime())))redirect('/admin/tickets/settings?error=invalid');
  let banner_url=String(form.get('banner_url')??'').trim();
 if(banner_url.length>2000 || (banner_url && !/^https:\/\/\S+$/.test(banner_url) && !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(banner_url))) redirect('/admin/tickets/settings?error=banner');
 const banner=form.get('banner');let uploadedPath:string|null=null;
 if(banner instanceof File && banner.size>0){
  if(banner.size>4*1024*1024)redirect('/admin/tickets/settings?error=banner');
  const bytes=Buffer.from(await banner.arrayBuffer());
  const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!type||banner.type!==type)redirect('/admin/tickets/settings?error=banner');
  uploadedPath=`${randomUUID()}.${type==='image/png'?'png':type==='image/jpeg'?'jpg':'webp'}`;
  const {error:uploadError}=await db.storage.from('ticket-banners').upload(uploadedPath,bytes,{contentType:type,upsert:false});
  if(uploadError)redirect('/admin/tickets/settings?error=bannerupload');
  banner_url=db.storage.from('ticket-banners').getPublicUrl(uploadedPath).data.publicUrl;
 }
 const record={title,venue,description,starts_at:date?.toISOString()??null,price_minor:Math.round(price*100),capacity,active,banner_url};
 const {data:savedEvent,error}=id?await db.from('ticket_events').update(record).eq('id',id).is('deleted_at',null).select('id').maybeSingle():await db.from('ticket_events').insert(record).select('id').single();
 if(error||!savedEvent){if(uploadedPath)await db.storage.from('ticket-banners').remove([uploadedPath]);redirect('/admin/tickets/settings?error=save');}
 revalidatePath('/tickets');redirect('/admin/tickets/settings?saved=1');
}
export async function saveTicketPayment(form:FormData) {
 const {db}=await staff();const payee=String(form.get('payee')??'').trim();const stc_pay=String(form.get('stc_pay')??'').trim();const bank_name=String(form.get('bank_name')??'').trim();const iban=String(form.get('iban')??'').replace(/\s/g,'').toUpperCase();const instructions=String(form.get('instructions')??'').trim();const enabled=form.get('enabled')==='on';
 if(!payee||payee.length>200||stc_pay.length>30||bank_name.length>100||iban.length>40||instructions.length>1000||(iban&&!/^SA\d{22}$/.test(iban))||(enabled&&!stc_pay&&(!bank_name||!iban)))redirect('/admin/tickets/settings?error=payment');
 const {error}=await db.from('ticket_payment_settings').update({payee,stc_pay,bank_name,iban,instructions,enabled}).eq('id',true);
 if(error)redirect('/admin/tickets/settings?error=save');
 revalidatePath('/tickets');redirect('/admin/tickets/settings?saved=1');
}
export async function deleteTicketEvent(form:FormData) {
 const {db}=await staff();const id=String(form.get('id')??'');
 if(!UUID.test(id)||form.get('confirm_delete')!=='on')redirect('/admin/tickets/settings?error=delete');
 const {error}=await db.rpc('delete_ticket_event',{p_id:id});
 if(error)redirect('/admin/tickets/settings?error=delete');
 revalidatePath('/tickets');revalidatePath('/admin/tickets');
 redirect('/admin/tickets/settings?deleted=1');
}
