import Landing from '@/components/landing';
import {getContent} from '@/lib/content';
import {createClient,isConfigured} from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';

async function isSignedIn() {
 if(!isConfigured())return false;
 try {
  const db=await createClient();
  return Boolean((await db.auth.getUser()).data.user);
 } catch {
  return false;
 }
}

export default async function Home(){
 const [content,signedIn]=await Promise.all([getContent(),isSignedIn()]);
 return <Landing content={content} signedIn={signedIn}/>;
}
