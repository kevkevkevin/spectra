import {requireAdmin} from '@/lib/admin';
import {logout} from '@/app/login/actions';
import Editor from '@/components/editor';
import type {ContentItem} from '@/lib/content';
export const dynamic='force-dynamic';
export default async function Admin({searchParams}:{searchParams:Promise<{error?:string;saved?:string}>}){
 const {db,user,isAdmin}=await requireAdmin();const params=await searchParams;
 if(!isAdmin)return <main className="admin-shell"><h1>Access required</h1><p>You’re signed in, but your account hasn’t been granted editor access. Contact the project owner.</p><form action={logout}><button className="button">Sign out</button></form></main>;
 const {data,error}=await db.from('content_items').select('*').order('kind').order('position');
 return <main className="admin-shell"><div className="admin-top"><a className="brand" href="/">SPECTRA</a><form action={logout}><button className="nav-cta">Sign out</button></form></div><p className="eyebrow">THE CREATIVE DESK</p><h1>Your next <em>spotlight.</em></h1><div className="admin-section-nav"><a href="/admin">Website content</a><a href="/admin/tickets">Ticket requests</a><a href="/admin/tickets/settings">Events & payments</a><a href="/admin/voting">Voting</a><a href="/admin/staff">Staff</a><a href="/staff/scan">Scanner</a></div><p>Signed in as {user.email}. Manage the content that appears on your website.</p>{params.error && <p role="alert">Changes could not be saved. Check the fields, permissions, and database setup, then try again.</p>}{params.saved && <p role="status">Your changes have been saved.</p>}{error && <p role="alert">Unable to load content. Check that the database migration has been applied.</p>}<details className="admin-item"><summary>Create new content <span>+</span></summary><Editor/></details>{(data as ContentItem[]??[]).map(item=><details className="admin-item" key={item.id}><summary><span>{item.kind} / {item.published?'Published':'Draft'}</span><h3>{item.title}</h3><span>+</span></summary><Editor item={item}/></details>)}<p>Sections without published items show the original landing-page content.</p></main>
}
