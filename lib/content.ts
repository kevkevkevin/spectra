import { isConfigured } from './supabase/server';
import { createClient } from '@supabase/supabase-js';
export type ContentItem = { id: string; kind: 'talent'|'service'|'news'; title: string; description: string; image_url: string; published: boolean; position: number };
export async function getContent(): Promise<ContentItem[]> {
  if (!isConfigured()) return [];
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await db.from('content_items').select('*').eq('published',true).order('position');
  if(error) { console.error('Content query failed:',error.code); return []; }
  return data ?? [];
}
