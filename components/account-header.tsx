import {createClient,isConfigured} from '@/lib/supabase/server';
import {logout} from '@/app/login/actions';
export default async function AccountHeader() {
 const db=isConfigured()?await createClient():null;
 const user=db?(await db.auth.getUser()).data.user:null;
 const admin=user && db ? (await db.from('admins').select('user_id').eq('user_id',user.id).maybeSingle()).data : null;
 const staff=user && db ? (await db.rpc('is_ticket_staff')).data : false;
 const judge=user && db ? (await db.rpc('is_contest_judge')).data : false;
 return <header className="account-header"><a className="brand" href="/"><img src="/assets/reference/logo-mark.png" alt=""/>SPECTRA</a><nav aria-label="Account navigation"><a href="/contest">Contest</a><a href="/tickets">Tickets</a>{user?<>{admin&&<><a href="/admin/tickets">Admin</a><a href="/admin/voting">Voting</a><a href="/admin/tabulation">Tabulation</a><a href="/admin/staff">Staff</a></>}{judge&&<a href="/judge">Judge desk</a>}{(staff||admin)&&<a href="/staff/scan">Scanner</a>}<a className="button" href="/account">My Account</a><form action={logout}><button className="text-button">Sign out</button></form></>:<a className="button" href="/login">Sign in / Sign up</a>}</nav></header>;
}
