'use server';
import {requireCustomer} from '@/lib/customer';
import {UUID} from '@/lib/tickets';
import {dispatchTicketEmails} from '@/lib/ticket-email';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {randomUUID} from 'node:crypto';
export type PurchaseState={error:string};
export async function purchaseTicket(_previous:PurchaseState,form:FormData):Promise<PurchaseState> {
 const {db,user}=await requireCustomer('/tickets');
 const id=String(form.get('order_id')??'');const eventId=String(form.get('event_id')??'');
 const quantity=Number(form.get('quantity'));const name=String(form.get('name')??'').trim();
 const phone=String(form.get('phone')??'').trim();const note=String(form.get('note')??'').trim();
 if(!UUID.test(id)||!UUID.test(eventId)||!Number.isInteger(quantity)||quantity<1||quantity>10||!name||name.length>120||phone.length<6||phone.length>30||note.length>1500) return {error:'Check your event, quantity, name, and phone number.'};
 if(!user.email_confirmed_at) return {error:'Confirm your email before requesting tickets.'};
 // A repeated form submission returns the original order without uploading another receipt.
 const {data:existing}=await db.from('ticket_orders').select('id').eq('id',id).eq('user_id',user.id).maybeSingle();
 if(existing) redirect(`/account/orders/${id}`);
 const receipt=form.get('receipt');
 if(!(receipt instanceof File)||receipt.size===0||receipt.size>4*1024*1024) return {error:'Choose a PNG, JPEG, or WebP receipt image up to 4 MB.'};
 const bytes=Buffer.from(await receipt.arrayBuffer());
 const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!type || receipt.type!==type) return {error:'The receipt must be a valid PNG, JPEG, or WebP image.'};
 const extension=type==='image/png'?'png':type==='image/jpeg'?'jpg':'webp';
 const path=`${user.id}/${id}/${randomUUID()}.${extension}`;
 const {error:uploadError}=await db.storage.from('ticket-receipts').upload(path,bytes,{contentType:type,upsert:false});
 if(uploadError) return {error:'Receipt upload failed. Check the file and try again. If this continues, contact Spectra.'};
 const {error}=await db.rpc('submit_ticket_order',{p_id:id,p_event_id:eventId,p_quantity:quantity,p_name:name,p_phone:phone,p_receipt_path:path,p_note:note});
 if(error) {
  // If a network timeout followed a committed transaction, preserve the receipt and order.
  const {data:saved}=await db.from('ticket_orders').select('id').eq('id',id).eq('user_id',user.id).maybeSingle();
  if(!saved) {
   await db.storage.from('ticket-receipts').remove([path]);
   const messages=['Not enough seats remain; please contact Spectra','This event is not available','Ticket sales are not open','Too many requests; please contact Spectra','Confirm your email first'];
   return {error:messages.find(message=>error.message.includes(message))??'Your request could not be saved. Please try again or contact Spectra if payment has already been made.'};
  }
 }
 try{await dispatchTicketEmails(id);}catch{ /* The durable email queue remains available for retry. */ }
 revalidatePath('/account');revalidatePath('/admin/tickets');
 redirect(`/account/orders/${id}?submitted=1`);
}
