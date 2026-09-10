'use server';
import {requireAdmin} from '@/lib/admin';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
function text(form:FormData,key:string,max:number){return String(form.get(key)??'').trim().slice(0,max);}
export async function saveContent(form:FormData){
 const {db,isAdmin}=await requireAdmin();if(!isAdmin) redirect('/admin?error=forbidden');
 const id=text(form,'id',36);const kind=text(form,'kind',20);const title=text(form,'title',150);const description=text(form,'description',3000);const image_url=text(form,'image_url',2000);const position=Number(form.get('position'));
 if(!['talent','service','news'].includes(kind)||!title||!Number.isInteger(position)||Math.abs(position)>10000) redirect('/admin?error=invalid');
 if(image_url){try{if(new URL(image_url).protocol!=='https:') throw new Error();}catch{redirect('/admin?error=invalid');}}
 const record={kind,title,description,image_url,position,published:form.get('published')==='on'};
 const {error}=id?await db.from('content_items').update(record).eq('id',id):await db.from('content_items').insert(record);
 if(error) redirect('/admin?error=save');
 revalidatePath('/');revalidatePath('/admin');redirect('/admin?saved=1');
}
export async function deleteContent(form:FormData){
 const {db,isAdmin}=await requireAdmin();if(!isAdmin) redirect('/admin?error=forbidden');
 if(form.get('confirm')!=='on') redirect('/admin?error=confirm');
 const {error}=await db.from('content_items').delete().eq('id',text(form,'id',36));
 if(error) redirect('/admin?error=save');
 revalidatePath('/');revalidatePath('/admin');redirect('/admin?saved=1');
}
