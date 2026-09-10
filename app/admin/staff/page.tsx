import {redirect} from 'next/navigation';
import {requireAdmin} from '@/lib/admin';
import AccountHeader from '@/components/account-header';
import SubmitButton from '@/components/submit-button';
import {setStaffAccess} from './actions';

export const dynamic='force-dynamic';

type StaffUser={user_id:string;email:string|null;display_name:string|null;is_staff:boolean;is_admin:boolean;confirmed:boolean};
type StaffParams={search?:string|string[];saved?:string;error?:string};

const errors:Record<string,string>={
 invalid:'Choose a valid user and try again.',
 setup:'Staff management needs the 004 staff and scanner database migration. Apply it in Supabase, then reload this page.',
 save:'Staff access could not be updated. The user may no longer exist or may already be an admin. Reload this page and try again.',
};

export default async function StaffManagement({searchParams}:{searchParams:Promise<StaffParams>}) {
 const {db,isAdmin}=await requireAdmin('/admin/staff');
 if(!isAdmin)redirect('/account');
 const query=await searchParams;
 const search=(typeof query.search==='string'?query.search:'').trim().slice(0,100);
 const {data,error}=await db.rpc('list_ticket_users',{p_search:search,p_limit:50});
 const users=(data??[]) as StaffUser[];
 const setupNeeded=error&&['PGRST202','42883'].includes(error.code);

 return <><AccountHeader/><main className="ticket-shell staff-admin-shell">
  <a className="text-link" href="/admin/tickets">← Ticket desk</a>
  <p className="eyebrow">The Spectra crew</p>
  <div className="ticket-title-row"><h1>Choose your staff.</h1><a className="button button-outline" href="/staff/scan">Open scanner ↗</a></div>
  <p className="ticket-intro">Give registered users access to the event entry and food scanners. Your staff can scan guest tickets in either mode. Ticket approvals, payment settings, and staff access stay with admins.</p>
  {query.saved==='added'&&<p className="notice staff-role-success" role="status">Staff access added. This user can now open the scanner from their account.</p>}
  {query.saved==='removed'&&<p className="notice staff-role-success" role="status">Staff access removed. This user keeps their account and tickets.</p>}
  {query.error&&<p className="notice staff-role-error" role="alert">{errors[query.error]??errors.save}</p>}
  <section className="ticket-panel staff-directory" aria-labelledby="staff-directory-title">
   <div className="staff-directory-heading"><div><h2 id="staff-directory-title">People & access</h2><p>Users appear here after signing up on your website.</p></div>{!error&&<span className="status-badge">{users.length} shown</span>}</div>
   <form method="get" action="/admin/staff" className="staff-search">
    <label htmlFor="staff-search">Find a user<input id="staff-search" type="search" name="search" defaultValue={search} maxLength={100} placeholder="Search by name or email"/></label>
    <button className="button" type="submit">Search</button>
    {search&&<a className="text-link" href="/admin/staff">Clear</a>}
   </form>
   {error?<p className="notice staff-role-error" role="alert">{setupNeeded?errors.setup:'The user list could not be loaded. Reload the page to try again.'}</p>:users.length===0?<div className="staff-empty"><h3>{search?'No matching users.':'Your crew starts here.'}</h3><p>{search?'Try a different name or email address.':'Ask your staff to create an account, then return here to give them scanner access.'}</p></div>:<ul className="staff-user-list">{users.map(person=><li className="staff-user-row" key={person.user_id}>
    <div className="staff-user-identity"><h3>{person.display_name?.trim()||person.email||'Registered user'}</h3>{person.email&&<p>{person.email}</p>}{!person.confirmed&&<small>Email confirmation pending</small>}</div>
    <div className="staff-user-access"><span className={`status-badge ${person.is_admin||person.is_staff?'approved':''}`}>{person.is_admin?'Admin · scanner access':person.is_staff?'Staff · entry + food':'Guest'}</span>
     {!person.is_admin&&<form action={setStaffAccess} className={person.is_staff?'staff-remove-form':'staff-add-form'}><input type="hidden" name="user_id" value={person.user_id}/><input type="hidden" name="staff" value={person.is_staff?'false':'true'}/><input type="hidden" name="search" value={search}/><SubmitButton pending={person.is_staff?'Removing…':'Adding…'}>{person.is_staff?'Remove staff':'Make staff'}</SubmitButton></form>}
    </div>
   </li>)}</ul>}
   {!error&&<p className="staff-results-note">Up to 50 users are shown. Search by name or email to find a specific person.</p>}
  </section>
 </main></>;
}
