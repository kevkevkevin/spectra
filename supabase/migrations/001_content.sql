-- Run once in the Supabase SQL Editor. No service-role key is used by the app.
create table public.admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
create policy "Read own admin membership" on public.admins for select to authenticated using (user_id = (select auth.uid()));
-- Membership can only be assigned by the project owner through SQL, not by app users.
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

create table public.content_items (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('talent','service','news')),
 title text not null check (length(trim(title)) between 1 and 150),
 description text not null default '' check (length(description)<=3000),
 image_url text not null default '' check (length(image_url)<=2000 and (image_url='' or image_url ~ '^https://')),
 published boolean not null default false,
 position integer not null default 0 check (position between -10000 and 10000),
 created_at timestamptz not null default now()
);
alter table public.content_items enable row level security;
revoke all on public.content_items from anon, authenticated;
grant select on public.content_items to anon, authenticated;
grant insert, update, delete on public.content_items to authenticated;
create policy "Published content is public" on public.content_items for select to anon, authenticated using (published);
create policy "Admins manage content" on public.content_items for all to authenticated
 using (exists (select 1 from public.admins where user_id = (select auth.uid())))
 with check (exists (select 1 from public.admins where user_id = (select auth.uid())));
create index content_public_order on public.content_items(kind,position) where published;
