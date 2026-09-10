import {login} from './actions';
import {isConfigured} from '@/lib/supabase/server';
import {safeNext} from '@/lib/customer';
import SubmitButton from '@/components/submit-button';

export default async function Login({searchParams}:{searchParams:Promise<{error?:string;next?:string}>}) {
 const {error,next:requested}=await searchParams;
 const ready=isConfigured();
 const next=safeNext(requested);

 return <main className="signup-shell">
  <a className="brand signup-brand" href="/"><img src="/assets/reference/logo-mark.png" alt=""/>SPECTRA</a>
  <div className="signup-layout">
   <section className="signup-art">
    <img className="signup-stage" src="/assets/reference/hero.jpg" alt=""/>
    <img className="signup-emblem" src="/assets/reference/logo.webp" alt="Spectra Performing Arts and Production"/>
    <div>
     <p className="eyebrow">Your place in the house</p>
     <h2>The stage is<br/><em>waiting for you.</em></h2>
     <p>Your tickets, votes, and Spectra nights are all here.</p>
    </div>
   </section>
   <section className="admin-shell auth-shell signup-form-panel">
    <p className="eyebrow">Welcome to the house</p>
    <h1>Welcome <em>back.</em></h1>
    <p>Sign in to book your next night, cast your ticket vote, or check your QR tickets. Staff can open the scanner here too.</p>
    {!ready?<p role="status">Sign-in setup is not available yet.</p>:error&&<p role="alert">{error==='setup'?'Supabase setup is required.':error==='confirmation'?'This confirmation link has expired or is invalid. Try signing in if you already confirmed your email.':'Unable to sign in. Check your email and password, and confirm your email if you just registered.'}</p>}
    <form action={login}>
     <input type="hidden" name="next" value={next}/>
     <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com"/></label>
     <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} placeholder="Your password"/></label>
     <SubmitButton disabled={!ready} pending="Signing in…">Sign in ↗</SubmitButton>
    </form>
    <p className="signup-login">New to Spectra? <a href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</a></p>
    <a className="text-link" href="/tickets">Explore the nights ↗</a>
   </section>
  </div>
  <p className="signup-bottom">Dream it. Believe it. Perform it.</p>
 </main>;
}
