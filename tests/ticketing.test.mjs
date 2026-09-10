import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Execute the actual migrations in PostgreSQL. The fixture substitutes only
// Supabase's platform-owned auth/storage schemas and request-role handling.
const users = {
  alice: '20000000-0000-4000-8000-000000000001',
  bob: '20000000-0000-4000-8000-000000000002',
  admin: '20000000-0000-4000-8000-000000000003',
  unconfirmed: '20000000-0000-4000-8000-000000000004',
  staff: '20000000-0000-4000-8000-000000000005',
};
const eventId = '10000000-0000-4000-8000-000000000001';
const contestEventId = '10000000-0000-4000-8000-000000000002';
const campaignId = '30000000-0000-4000-8000-000000000001';
const contenderId = '31000000-0000-4000-8000-000000000001';
let db;
let initialEvents;
let initialSettings;

async function asRole(role, user, sql, params = []) {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    return tx.query(sql, params);
  });
}

const asUser = (user, sql, params) => asRole('authenticated', users[user], sql, params);
const scalar = (result, name = 'count') => result.rows[0][name];
const denied = (operation, message = /permission denied|row-level security/i) => assert.rejects(operation, message);

async function upload(user = 'alice', id = randomUUID()) {
  const path = `${users[user]}/${id}/receipt.png`;
  await asUser(user, "insert into storage.objects(bucket_id, name) values ('ticket-receipts', $1)", [path]);
  return { id, path };
}

async function submit(user = 'alice', options = {}) {
  const receipt = options.receipt ?? await upload(user);
  const values = [receipt.id, options.eventId ?? eventId, options.quantity ?? 1, '  Spectra Guest  ', '+966500000001', receipt.path, 'Transfer attached'];
  for (const [index, value] of Object.entries(options.overrides ?? {})) values[Number(index)] = value;
  const result = await asUser(user, 'select public.submit_ticket_order($1, $2, $3, $4, $5, $6, $7) as id', values);
  return { ...receipt, id: scalar(result, 'id'), values };
}

const review = (id, decision = 'approved', note = '', user = 'admin') => asUser(user,
  'select public.review_ticket_order($1, $2, $3)', [id, decision, note]);

const assignStaff = (user = 'staff', assigned = true, actor = 'admin') => asUser(actor,
  'select public.set_ticket_staff($1, $2)', [users[user], assigned]);
const scan = async (token, mode = 'entry', event = eventId, user = 'staff') =>
  (await asUser(user, 'select * from public.scan_ticket($1, $2, $3)', [token, mode, event])).rows[0];
const castVote = async (user = 'alice', contestant = contenderId, campaign = campaignId) =>
  (await asUser(user, 'select * from public.cast_contest_vote($1,$2)', [campaign, contestant])).rows[0];
const voteStatus = async (user = 'alice', campaign = campaignId) =>
  (await asUser(user, 'select * from public.contest_vote_status($1)', [campaign])).rows[0];
async function approveTickets(user = 'alice', quantity = 1, event = contestEventId) {
  const order = await submit(user, { quantity, eventId: event });
  await review(order.id);
  return order;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email text not null, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table storage.buckets(
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      created_at timestamptz not null default now(),
      unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant all on storage.objects, storage.buckets to service_role;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1]
    $$;
  `);
  for (const name of ['001_content.sql', '002_ticketing.sql', '003_event_management.sql', '004_staff_scanning.sql', '005_ticket_voting.sql', '006_deployment_hardening.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  initialEvents = (await db.query('select active, starts_at from public.ticket_events')).rows;
  initialSettings = (await db.query('select enabled from public.ticket_payment_settings')).rows;
});

beforeEach(async () => {
  await db.exec(`
    truncate table public.ticket_votes;
    delete from public.contestants where campaign_id<>'${campaignId}' or number not between 1 and 21;
    delete from public.voting_campaigns where id<>'${campaignId}';
    delete from public.ticket_notifications;
    delete from public.issued_tickets;
    delete from public.ticket_orders;
    delete from public.ticket_events where id not in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
    delete from storage.objects;
    delete from public.content_items;
    delete from public.ticket_staff;
    delete from public.admins;
    delete from auth.users;
    update public.ticket_events set active=true, deleted_at=null, banner_url='', starts_at=now()+interval '30 days', capacity=100,
      price_minor=case when id='${eventId}' then 5000 else 7500 end;
    update public.ticket_payment_settings set enabled=true;
    update public.voting_campaigns set event_id='${contestEventId}',eyebrow='Elimination rounds',headline='TOP 21 Official Contenders',
      title='Spectra’s Next Singing Idol',description='The Top 21 official contenders take the Bora stage. Two elimination nights. One house vote. One star.',
      prize='Grand prize · 100,000 PHP',hero_url='/assets/reference/contest-top21.jpg',active=true,results_visible=true,opens_at=null,closes_at=null
      where id='${campaignId}';
    update public.contestants set name='Contender '||lpad(number::text,2,'0'),description='',
      image_url='/assets/contest/c'||lpad(number::text,2,'0')||'.jpg',active=true,position=number
      where campaign_id='${campaignId}';
  `);
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,$3)',
      [id, `${name}@example.com`, name === 'unconfirmed' ? null : new Date().toISOString()]);
  }
  await db.query('insert into public.admins(user_id) values ($1)', [users.admin]);
});

after(async () => { await db?.close(); });

describe('migrations and content authorization', () => {
  test('event management opens seeded sales without requiring dates; receipts remain private', async () => {
    assert.equal(initialEvents.length, 2);
    assert.ok(initialEvents.every((event) => event.active === true && event.starts_at === null));
    assert.deepEqual(initialSettings, [{ enabled: true }]);
    const bucket = (await db.query("select * from storage.buckets where id='ticket-receipts'")).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 4 * 1024 * 1024);
    assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  });

  test('public content is readable; only an assigned admin can manage drafts', async () => {
    await asUser('admin', "insert into public.content_items(kind,title,published) values ('news','Public',true),('news','Draft',false)");
    assert.deepEqual((await asRole('anon', null, 'select title from public.content_items')).rows, [{ title: 'Public' }]);
    assert.equal(scalar(await asUser('admin', 'select count(*) from public.content_items')), 2);
    await denied(() => asUser('alice', "insert into public.content_items(kind,title) values ('news','Injected')"));
    assert.equal((await asUser('alice', "update public.content_items set title='Changed' returning id")).rows.length, 0);
    assert.equal((await asUser('alice', 'delete from public.content_items returning id')).rows.length, 0);
    assert.equal((await asUser('admin', "update public.content_items set title='Updated' where not published returning id")).rows.length, 1);
  });
});

describe('event management', () => {
  test('open events accept bookings without a date or after the date until an admin pauses sales', async () => {
    await asUser('admin', 'update public.ticket_events set starts_at=null where id=$1', [eventId]);
    const undated = await submit();
    assert.equal(scalar(await db.query('select event_starts_at from public.ticket_orders where id=$1', [undated.id]), 'event_starts_at'), null);
    await asUser('admin', "update public.ticket_events set starts_at=now()-interval '1 day' where id=$1", [eventId]);
    await submit('bob');
    await asUser('admin', 'update public.ticket_events set active=false where id=$1', [eventId]);
    await assert.rejects(() => submit(), /event is not available/);
  });

  test('admins can edit the full event and new events default to open', async () => {
    const id = randomUUID();
    await asUser('admin', "insert into public.ticket_events(id,title,venue,price_minor) values ($1,'New show','Jeddah',5000)", [id]);
    assert.equal(scalar(await db.query('select active from public.ticket_events where id=$1', [id]), 'active'), true);
    await asUser('admin', "update public.ticket_events set title='Updated show', description='Live music', venue='New venue', starts_at=null, price_minor=6000, capacity=250, banner_url='https://example.com/banner.jpg' where id=$1", [id]);
    const result = (await asRole('anon', null, 'select title,description,venue,starts_at,price_minor,capacity,banner_url from public.ticket_events where id=$1', [id])).rows[0];
    assert.deepEqual(result, { title: 'Updated show', description: 'Live music', venue: 'New venue', starts_at: null, price_minor: 6000, capacity: 250, banner_url: 'https://example.com/banner.jpg' });
    await assert.rejects(() => asUser('admin', "update public.ticket_events set banner_url='javascript:alert(1)' where id=$1", [id]), /ticket_event_banner_url/);
  });

  test('deleting hides an event and blocks new purchases while keeping existing orders and tickets', async () => {
    const order = await submit();
    await review(order.id);
    await denied(() => asRole('anon', null, 'select public.delete_ticket_event($1)', [eventId]));
    await assert.rejects(() => asUser('alice', 'select public.delete_ticket_event($1)', [eventId]), /Admin access required/);
    await asUser('admin', 'select public.delete_ticket_event($1)', [eventId]);
    assert.equal((await asRole('anon', null, 'select id from public.ticket_events where id=$1', [eventId])).rows.length, 0);
    assert.equal((await asUser('alice', 'select id from public.ticket_events where id=$1', [eventId])).rows.length, 0);
    assert.equal((await asRole('anon', null, 'select * from public.ticket_availability() where event_id=$1', [eventId])).rows.length, 0);
    assert.equal((await asUser('admin', 'select id from public.ticket_events where id=$1', [eventId])).rows.length, 1);
    await assert.rejects(() => submit('bob'), /event is not available/);
    assert.equal(scalar(await asUser('alice', 'select count(*) from public.ticket_orders')), 1);
    assert.equal(scalar(await asUser('alice', 'select count(*) from public.issued_tickets')), 1);
    const token = scalar(await asUser('alice', 'select token from public.issued_tickets'), 'token');
    await asUser('admin', 'select public.check_in_ticket($1)', [token]);
    await denied(() => asUser('admin', 'update public.ticket_events set deleted_at=null where id=$1', [eventId]));
    assert.equal((await asUser('admin', 'update public.ticket_events set active=true where id=$1 returning id', [eventId])).rows.length, 0);
    await asUser('admin', 'select public.delete_ticket_event($1)', [eventId]);
  });

  test('reapplying the migration preserves pauses and deleted events', async () => {
    await asUser('admin', 'select public.delete_ticket_event($1)', [eventId]);
    await db.exec('update public.ticket_events set active=false; update public.ticket_payment_settings set enabled=false');
    await db.exec(await readFile(new URL('../supabase/migrations/003_event_management.sql', import.meta.url), 'utf8'));
    assert.ok((await db.query('select active from public.ticket_events')).rows.every((event) => event.active === false));
    assert.equal(scalar(await db.query('select enabled from public.ticket_payment_settings'), 'enabled'), false);
    assert.equal((await asRole('anon', null, 'select id from public.ticket_events where id=$1', [eventId])).rows.length, 0);
  });

  test('banner uploads are public assets restricted to admins; receipt policies remain separate', async () => {
    const bucket = (await db.query("select * from storage.buckets where id='ticket-banners'")).rows[0];
    assert.equal(bucket.public, true);
    assert.equal(Number(bucket.file_size_limit), 4 * 1024 * 1024);
    await denied(() => asUser('alice', "insert into storage.objects(bucket_id,name) values ('ticket-banners','banner.png')"));
    await asUser('admin', "insert into storage.objects(bucket_id,name) values ('ticket-banners','banner.png')");
    assert.equal((await asUser('alice', "select name from storage.objects where bucket_id='ticket-banners'")).rows.length, 1);
    assert.equal((await asUser('alice', "delete from storage.objects where bucket_id='ticket-banners' returning id")).rows.length, 0);
    assert.equal((await asUser('admin', "delete from storage.objects where bucket_id='ticket-banners' returning id")).rows.length, 1);
  });
});

describe('private receipt storage', () => {
  test('owners and admins can see a receipt; another customer and anonymous users cannot', async () => {
    const receipt = await upload();
    assert.equal((await asUser('alice', 'select name from storage.objects')).rows[0].name, receipt.path);
    assert.equal((await asUser('bob', 'select name from storage.objects')).rows.length, 0);
    assert.equal((await asUser('admin', 'select name from storage.objects')).rows.length, 1);
    await denied(() => asRole('anon', null, 'select name from storage.objects'));
    await denied(() => asUser('bob', "insert into storage.objects(bucket_id,name) values ('ticket-receipts',$1)",
      [`${users.alice}/${randomUUID()}/receipt.png`]));
    assert.equal((await asUser('bob', 'delete from storage.objects returning id')).rows.length, 0);
    assert.equal((await asUser('alice', "update storage.objects set name=name||'.changed' returning id")).rows.length, 0);
    assert.equal((await asUser('alice', 'delete from storage.objects returning id')).rows.length, 1);
  });

  test('a receipt attached to any submitted order cannot be changed or deleted', async () => {
    const order = await submit();
    for (const user of ['alice', 'bob', 'admin']) {
      assert.equal((await asUser(user, 'delete from storage.objects where name=$1 returning id', [order.path])).rows.length, 0);
      assert.equal((await asUser(user, "update storage.objects set name=name||'.changed' where name=$1 returning id", [order.path])).rows.length, 0);
    }
    await review(order.id, 'rejected', 'Payment cannot be verified.');
    assert.equal((await asUser('alice', 'delete from storage.objects where name=$1 returning id', [order.path])).rows.length, 0);
    assert.equal(scalar(await db.query('select count(*) from storage.objects')), 1);
  });

  test('receipt upload rate limit is scoped to the owner', async () => {
    await denied(() => asRole('anon', null, 'select public.can_upload_ticket_receipt()'));
    assert.equal(scalar(await asUser('alice', 'select public.can_upload_ticket_receipt() as allowed'), 'allowed'), true);
    for (let index = 0; index < 20; index++) await upload();
    assert.equal(scalar(await asUser('alice', 'select public.can_upload_ticket_receipt() as allowed'), 'allowed'), false);
    assert.equal(scalar(await asUser('bob', 'select public.can_upload_ticket_receipt() as allowed'), 'allowed'), true);
    await denied(() => upload());
    await upload('bob');
    await db.exec("update storage.objects set created_at=now()-interval '2 hours'");
    await upload();
    assert.equal(scalar(await db.query('select count(*) from storage.objects')), 22);
  });
});

describe('customer submission and isolation', () => {
  test('requires authentication, confirmed email, enabled payments, and an active event', async () => {
    await denied(() => asRole('anon', null, 'select public.submit_ticket_order($1,$2,1,$3,$4,$5)',
      [randomUUID(), eventId, 'Guest', '+966500000001', 'receipt.png']));
    await assert.rejects(() => asRole('authenticated', null, 'select public.submit_ticket_order($1,$2,1,$3,$4,$5)',
      [randomUUID(), eventId, 'Guest', '+966500000001', 'receipt.png']), /Sign in required/);
    await assert.rejects(() => submit('unconfirmed'), /Confirm your email first/);
    await db.exec('update public.ticket_payment_settings set enabled=false');
    await assert.rejects(() => submit(), /Ticket sales are not open/);
    await db.exec('update public.ticket_payment_settings set enabled=true; update public.ticket_events set active=false');
    await assert.rejects(() => submit(), /event is not available/);
    await db.exec('update public.ticket_events set active=true');
    await assert.rejects(() => submit('alice', { eventId: randomUUID() }), /event is not available/);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_orders')), 0);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications')), 0);
  });

  test('validates quantity, contact details, notes, and an uploaded receipt bound to the order', async () => {
    const receipt = await upload();
    for (const quantity of [null, -1, 0, 11]) {
      await assert.rejects(() => submit('alice', { receipt, overrides: { 2: quantity } }), /Invalid order details/);
    }
    for (const overrides of [{ 3: ' ' }, { 3: 'x'.repeat(121) }, { 4: '123' }, { 4: 'x'.repeat(31) }, { 6: 'x'.repeat(1501) }]) {
      await assert.rejects(() => submit('alice', { receipt, overrides }), /Invalid order details/);
    }
    await assert.rejects(() => submit('alice', { receipt, overrides: { 5: `${users.alice}/${receipt.id}/missing.png` } }), /Upload a receipt first/);
    const other = await upload('bob');
    await assert.rejects(() => submit('alice', { receipt, overrides: { 5: other.path } }), /Upload a receipt first/);
    const differentOrder = await upload();
    await assert.rejects(() => submit('alice', { receipt, overrides: { 5: differentOrder.path } }), /Upload a receipt first/);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_orders')), 0);
  });

  test('prices and verified email come from the server and stay fixed after event edits', async () => {
    const order = await submit('alice', { quantity: 3 });
    await asUser('admin', 'update public.ticket_events set price_minor=9900 where id=$1', [eventId]);
    const stored = (await asUser('alice', 'select * from public.ticket_orders where id=$1', [order.id])).rows[0];
    assert.equal(stored.customer_name, 'Spectra Guest');
    assert.equal(stored.customer_email, 'alice@example.com');
    assert.equal(stored.quantity, 3);
    assert.equal(stored.unit_price_minor, 5000);
    assert.equal(stored.total_minor, 15000);
    assert.equal(stored.event_title, 'Spectra Live Night');
    assert.equal(stored.event_venue, 'Bora Cafe, Ground Floor, Jeddah');
    assert.equal(stored.status, 'pending');
    assert.equal(scalar(await db.query("select count(*) from public.ticket_notifications where order_id=$1 and kind='submitted'", [order.id])), 1);
  });

  test('customers only see their own orders and issued QR tokens; admins see the queue', async () => {
    const alice = await submit('alice', { quantity: 2 });
    const bob = await submit('bob');
    await review(alice.id);
    await review(bob.id);
    for (const [user, id, count] of [['alice', alice.id, 2], ['bob', bob.id, 1]]) {
      assert.deepEqual((await asUser(user, 'select id from public.ticket_orders')).rows, [{ id }]);
      assert.equal(scalar(await asUser(user, 'select count(*) from public.issued_tickets')), count);
      assert.equal(scalar(await asUser(user, 'select count(*) from public.ticket_notifications')), 0);
      assert.equal(scalar(await asUser(user, 'select count(*) from public.admins')), 0);
    }
    assert.equal(scalar(await asUser('admin', 'select count(*) from public.ticket_orders')), 2);
    assert.equal(scalar(await asUser('admin', 'select count(*) from public.issued_tickets')), 3);
    assert.equal(scalar(await asUser('admin', 'select count(*) from public.ticket_notifications')), 4);
    await denied(() => asRole('anon', null, 'select * from public.ticket_orders'));
    await denied(() => asRole('anon', null, 'select * from public.issued_tickets'));
  });

  test('customers cannot change prices, approve orders, issue tickets, mutate the outbox, or make themselves admins', async () => {
    const order = await submit();
    for (const sql of [
      `insert into public.admins(user_id) values ('${users.alice}')`,
      'delete from public.admins',
      "update public.ticket_orders set status='approved'",
      'delete from public.ticket_orders',
      'insert into public.ticket_orders(id) values (gen_random_uuid())',
      'insert into public.issued_tickets(order_id,seat_number) values ($1,1)',
      'update public.issued_tickets set checked_in_at=now()',
      "insert into public.ticket_notifications(order_id,kind) values ($1,'approved')",
      "update public.ticket_notifications set state='sent'",
    ]) await denied(() => asUser('alice', sql, sql.includes('$1') ? [order.id] : []));
    assert.equal((await asUser('alice', 'update public.ticket_events set price_minor=100 returning id')).rows.length, 0);
    assert.equal((await asUser('alice', "update public.ticket_payment_settings set stc_pay='hijacked' returning id")).rows.length, 0);
    await denied(() => asUser('alice', "insert into public.ticket_events(title,venue,price_minor) values ('Fake','Fake',100)"));
    await assert.rejects(() => review(order.id, 'approved', '', 'alice'), /Admin access required/);
    await assert.rejects(() => asUser('alice', 'select public.check_in_ticket($1)', [randomUUID()]), /Admin access required/);
    assert.equal(scalar(await asUser('alice', 'select public.is_ticket_admin() as result'), 'result'), false);
    assert.equal(scalar(await asUser('admin', 'select public.is_ticket_admin() as result'), 'result'), true);
  });

  test('pending and approved orders reserve capacity; rejected orders release it', async () => {
    await db.query('update public.ticket_events set capacity=3 where id=$1', [eventId]);
    const first = await submit('alice', { quantity: 3 });
    await assert.rejects(() => submit('bob'), /Not enough seats remain/);
    await review(first.id, 'rejected', 'Transfer was not received.');
    const second = await submit('bob', { quantity: 3 });
    await review(second.id);
    await assert.rejects(() => submit('alice'), /Not enough seats remain/);
    assert.equal(scalar(await db.query("select sum(quantity) as count from public.ticket_orders where status in ('pending','approved')")), 3);
  });

  test('public availability reports seat counts without exposing orders or customer information', async () => {
    await db.query('update public.ticket_events set capacity=4 where id=$1', [eventId]);
    const pending = await submit('alice', { quantity: 2 });
    const approved = await submit('bob');
    await review(approved.id);
    for (const [role, user] of [['anon', null], ['authenticated', users.alice]]) {
      const availability = (await asRole(role, user, 'select * from public.ticket_availability() where event_id=$1', [eventId])).rows;
      assert.deepEqual(availability, [{ event_id: eventId, remaining: 1 }]);
    }
    await review(pending.id, 'rejected', 'Transfer missing.');
    assert.equal(scalar(await asRole('anon', null, 'select remaining from public.ticket_availability() where event_id=$1', [eventId]), 'remaining'), 3);
    await db.query('update public.ticket_events set capacity=1 where id=$1', [eventId]);
    assert.equal(scalar(await asRole('anon', null, 'select remaining from public.ticket_availability() where event_id=$1', [eventId]), 'remaining'), 0);
  });

  test('repeating a submission is idempotent and another user cannot reuse its ID', async () => {
    const order = await submit('alice', { quantity: 2 });
    await db.exec('update public.ticket_payment_settings set enabled=false');
    const retry = await submit('alice', { receipt: order, quantity: 8 });
    assert.equal(retry.id, order.id);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_orders')), 1);
    assert.equal(scalar(await db.query('select quantity from public.ticket_orders'), 'quantity'), 2);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications')), 1);
    await assert.rejects(() => submit('bob', { receipt: order }), /Order unavailable/);
  });

  test('limits each customer to five pending and ten recent requests', async () => {
    const orders = [];
    for (let index = 0; index < 5; index++) orders.push(await submit());
    await assert.rejects(() => submit(), /Too many requests/);
    await submit('bob');
    for (const order of orders) await review(order.id, 'rejected', 'Duplicate transfer.');
    for (let index = 0; index < 5; index++) {
      const order = await submit();
      await review(order.id, 'rejected', 'Duplicate transfer.');
    }
    await assert.rejects(() => submit(), /Too many requests/);
    await db.exec("update public.ticket_orders set created_at=now()-interval '2 hours'");
    await submit();
    assert.equal(scalar(await db.query('select count(*) from public.ticket_orders where user_id=$1', [users.alice])), 11);
  });
});

describe('admin decisions and ticket issuance', () => {
  test('approval issues one unique QR credential per seat and retries do not duplicate tickets or emails', async () => {
    const order = await submit('alice', { quantity: 3 });
    await review(order.id, 'approved', '  Payment verified  ');
    const issued = (await asUser('alice', 'select seat_number,token from public.issued_tickets order by seat_number')).rows;
    assert.deepEqual(issued.map((ticket) => ticket.seat_number), [1, 2, 3]);
    assert.equal(new Set(issued.map((ticket) => ticket.token)).size, 3);
    assert.ok(issued.every((ticket) => /^[0-9a-f-]{36}$/.test(ticket.token)));
    await review(order.id, 'approved', 'Different retry note');
    assert.deepEqual((await asUser('alice', 'select seat_number,token from public.issued_tickets order by seat_number')).rows, issued);
    const stored = (await db.query('select * from public.ticket_orders where id=$1', [order.id])).rows[0];
    assert.equal(stored.status, 'approved');
    assert.equal(stored.review_note, 'Payment verified');
    assert.equal(stored.reviewed_by, users.admin);
    assert.ok(stored.reviewed_at);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications where order_id=$1', [order.id])), 2);
    await assert.rejects(() => review(order.id, 'rejected', 'Changed mind'), /already been reviewed/);
  });

  test('rejection requires a reason, issues no ticket, and cannot later turn into approval', async () => {
    const order = await submit();
    await assert.rejects(() => review(order.id, 'rejected'), /rejection reason is required/);
    for (const decision of [null, 'pending', 'refunded']) await assert.rejects(() => review(order.id, decision), /Invalid decision/);
    await assert.rejects(() => review(order.id, 'approved', null), /Invalid decision/);
    await assert.rejects(() => review(order.id, 'approved', 'x'.repeat(1501)), /Invalid decision/);
    await assert.rejects(() => review(randomUUID()), /Order not found/);
    await review(order.id, 'rejected', '  Please upload a readable transfer receipt.  ');
    await review(order.id, 'rejected', 'Retry note');
    assert.equal(scalar(await db.query('select count(*) from public.issued_tickets')), 0);
    const stored = (await asUser('alice', 'select status,review_note from public.ticket_orders')).rows[0];
    assert.deepEqual(stored, { status: 'rejected', review_note: 'Please upload a readable transfer receipt.' });
    assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications')), 2);
    await assert.rejects(() => review(order.id), /already been reviewed/);
  });

  test('QR check-in is admin-only and succeeds exactly once for each approved ticket', async () => {
    const order = await submit('alice', { quantity: 2 });
    assert.equal(scalar(await asUser('admin', 'select public.check_in_ticket($1) as checked', [randomUUID()]), 'checked'), false);
    await review(order.id);
    const tickets = (await db.query('select token from public.issued_tickets order by seat_number')).rows;
    await assert.rejects(() => asUser('alice', 'select public.check_in_ticket($1)', [tickets[0].token]), /Admin access required/);
    for (const { token } of tickets) {
      assert.equal(scalar(await asUser('admin', 'select public.check_in_ticket($1) as checked', [token]), 'checked'), true);
      assert.equal(scalar(await asUser('admin', 'select public.check_in_ticket($1) as checked', [token]), 'checked'), false);
    }
    const checked = (await db.query('select checked_in_at,checked_in_by from public.issued_tickets')).rows;
    assert.ok(checked.every((ticket) => ticket.checked_in_at && ticket.checked_in_by === users.admin));
  });

  test('order creation, approval, tickets, and email outbox changes are transactional', async () => {
    await db.exec(`
      create function public.test_reject_notification() returns trigger language plpgsql as $$
        begin raise exception 'Simulated outbox failure'; end
      $$;
      create trigger test_reject_notification before insert on public.ticket_notifications
        for each row execute function public.test_reject_notification();
    `);
    try {
      await assert.rejects(() => submit(), /Simulated outbox failure/);
      assert.equal(scalar(await db.query('select count(*) from public.ticket_orders')), 0);
      assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications')), 0);
      await db.exec('alter table public.ticket_notifications disable trigger test_reject_notification');
      const order = await submit('alice', { quantity: 3 });
      await db.exec('alter table public.ticket_notifications enable trigger test_reject_notification');
      await assert.rejects(() => review(order.id), /Simulated outbox failure/);
      assert.equal(scalar(await db.query('select status from public.ticket_orders'), 'status'), 'pending');
      assert.equal(scalar(await db.query('select count(*) from public.issued_tickets')), 0);
      assert.equal(scalar(await db.query('select count(*) from public.ticket_notifications')), 1);
      await assert.rejects(() => review(order.id, 'rejected', 'Unreadable receipt.'), /Simulated outbox failure/);
      assert.equal(scalar(await db.query('select status from public.ticket_orders'), 'status'), 'pending');
    } finally {
      await db.exec('drop trigger test_reject_notification on public.ticket_notifications; drop function public.test_reject_notification()');
    }
  });
});

describe('staff roles and two-counter ticket scanning', () => {
  test('only admins assign staff; revocation takes effect immediately without changing admin access', async () => {
    assert.equal(scalar(await asUser('staff', 'select public.is_ticket_staff() as allowed'), 'allowed'), false);
    assert.equal(scalar(await asUser('admin', 'select public.is_ticket_staff() as allowed'), 'allowed'), true);
    await denied(() => asRole('anon', null, 'select public.is_ticket_staff()'));
    await denied(() => asRole('anon', null, 'select public.set_ticket_staff($1, true)', [users.staff]));
    await assert.rejects(() => assignStaff('alice', true, 'alice'), /Admin access required/);
    await assignStaff();
    const original = (await asUser('admin', 'select * from public.ticket_staff')).rows;
    assert.equal(original[0].assigned_by, users.admin);
    await assignStaff();
    assert.deepEqual((await asUser('admin', 'select * from public.ticket_staff')).rows, original);
    assert.equal(scalar(await asUser('staff', 'select public.is_ticket_staff() as allowed'), 'allowed'), true);
    await assert.rejects(() => assignStaff('alice', true, 'staff'), /Admin access required/);
    for (const actor of ['alice', 'staff', 'admin']) {
      await denied(() => asUser(actor, 'insert into public.ticket_staff(user_id) values ($1)', [users.bob]));
      await denied(() => asUser(actor, 'delete from public.ticket_staff'));
    }
    await assert.rejects(() => asUser('admin', 'select public.set_ticket_staff($1, true)', [randomUUID()]), /User not found/);
    await assert.rejects(() => asUser('admin', 'select public.set_ticket_staff($1, null)', [users.staff]), /Invalid staff assignment/);
    await assignStaff('staff', false);
    assert.equal(scalar(await asUser('staff', 'select public.is_ticket_staff() as allowed'), 'allowed'), false);
    await assert.rejects(() => scan(randomUUID()), /Staff access required/);
    await assignStaff('admin', true);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_staff where user_id=$1', [users.admin])), 0);
    await db.query('insert into public.ticket_staff(user_id,assigned_by) values ($1,$1)', [users.admin]);
    await db.exec(await readFile(new URL('../supabase/migrations/004_staff_scanning.sql', import.meta.url), 'utf8'));
    assert.equal(scalar(await db.query('select count(*) from public.ticket_staff where user_id=$1', [users.admin])), 0);
    await assignStaff('admin', false);
    assert.equal(scalar(await asUser('admin', 'select public.is_ticket_staff() as allowed'), 'allowed'), true);
  });

  test('admin user directory supports names and email while bounding results and excluding credentials', async () => {
    await assignStaff();
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [{ display_name: '  Gate Helper  ' }, users.staff]);
    await denied(() => asRole('anon', null, 'select * from public.list_ticket_users()'));
    for (const actor of ['alice', 'staff']) await assert.rejects(() => asUser(actor, 'select * from public.list_ticket_users()'), /Admin access required/);
    const result = (await asUser('admin', 'select * from public.list_ticket_users($1, $2)', ['HELPER', 50])).rows;
    assert.deepEqual(result, [{ user_id: users.staff, email: 'staff@example.com', display_name: 'Gate Helper', is_staff: true, is_admin: false, confirmed: true }]);
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1)', ['bob@'])).rows[0].display_name, 'bob');
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1)', ['unconfirmed'])).rows[0].confirmed, false);
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1)', ['admin'])).rows[0].is_admin, true);
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1, $2)', ['', 1])).rows.length, 1);
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1, $2)', ['', -100])).rows.length, 1);
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1)', ['%'])).rows.length, 0);
    await db.exec("insert into auth.users(id,email) select gen_random_uuid(),'directory'||n||'@example.com' from generate_series(1,120) n");
    assert.equal((await asUser('admin', 'select * from public.list_ticket_users($1, $2)', ['', 10000])).rows.length, 100);
  });

  test('metadata cannot grant staff or admin roles, and staff cannot access private records or management functions', async () => {
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [{ role: 'admin', is_staff: true, is_admin: true }, users.alice]);
    assert.equal(scalar(await asUser('alice', 'select public.is_ticket_staff() as allowed'), 'allowed'), false);
    assert.equal(scalar(await asUser('alice', 'select public.is_ticket_admin() as allowed'), 'allowed'), false);
    await assignStaff();
    const order = await submit();
    await review(order.id);
    for (const table of ['ticket_orders', 'issued_tickets', 'ticket_notifications', 'ticket_staff', 'admins']) {
      assert.equal(scalar(await asUser('staff', `select count(*) from public.${table}`)), 0);
    }
    assert.equal(scalar(await asUser('staff', "select count(*) from storage.objects where bucket_id='ticket-receipts'")), 0);
    await denied(() => asUser('staff', 'select email,raw_user_meta_data from auth.users'));
    await denied(() => asUser('staff', 'update public.issued_tickets set checked_in_at=now(),food_redeemed_at=now()'));
    await denied(() => asUser('staff', 'insert into public.admins(user_id) values ($1)', [users.staff]));
    await assert.rejects(() => review(order.id, 'approved', '', 'staff'), /Admin access required/);
    await assert.rejects(() => asUser('staff', 'select public.delete_ticket_event($1)', [eventId]), /Admin access required/);
    assert.equal((await asUser('staff', 'update public.ticket_events set active=false returning id')).rows.length, 0);
    assert.equal((await asUser('staff', 'update public.ticket_payment_settings set enabled=false returning id')).rows.length, 0);
    await denied(() => asUser('staff', "insert into storage.objects(bucket_id,name) values ('ticket-banners','staff-injected.png')"));
  });

  test('scanner event list is role-protected and includes deleted events without expanding public visibility', async () => {
    await assignStaff();
    await asUser('admin', 'select public.delete_ticket_event($1)', [eventId]);
    await denied(() => asRole('anon', null, 'select * from public.list_scannable_ticket_events()'));
    await assert.rejects(() => asUser('alice', 'select * from public.list_scannable_ticket_events()'), /Staff access required/);
    assert.equal((await asUser('staff', 'select * from public.ticket_events where id=$1', [eventId])).rows.length, 0);
    for (const actor of ['staff', 'admin']) {
      const events = (await asUser(actor, 'select * from public.list_scannable_ticket_events()')).rows;
      assert.equal(events.length, 2);
      assert.ok(events.some((event) => event.id === eventId));
      assert.deepEqual(Object.keys(events[0]).sort(), ['id', 'starts_at', 'title']);
    }
  });

  test('entry and food succeed once per seat, preserve audit details on duplicates, and are visible to owner and admin', async () => {
    await assignStaff();
    const order = await submit('alice', { quantity: 2 });
    await review(order.id);
    const tickets = (await db.query('select id,token,seat_number from public.issued_tickets order by seat_number')).rows;
    const entry = await scan(tickets[0].token);
    assert.equal(entry.result, 'success');
    assert.equal(entry.ticket_id, tickets[0].id);
    assert.equal(entry.guest_name, 'Spectra Guest');
    assert.equal(entry.event_title, 'Spectra Live Night');
    assert.equal(entry.seat_number, 1);
    assert.ok(entry.checked_in_at);
    assert.equal(entry.food_redeemed_at, null);
    const entryRetry = await scan(tickets[0].token, 'entry', eventId, 'admin');
    assert.equal(entryRetry.result, 'already_used');
    assert.deepEqual(entryRetry.checked_in_at, entry.checked_in_at);
    const food = await scan(tickets[0].token, 'food', eventId, 'admin');
    assert.equal(food.result, 'success');
    assert.ok(food.food_redeemed_at);
    assert.deepEqual(food.checked_in_at, entry.checked_in_at);
    const foodRetry = await scan(tickets[0].token, 'food');
    assert.equal(foodRetry.result, 'already_used');
    assert.deepEqual(foodRetry.food_redeemed_at, food.food_redeemed_at);
    for (const actor of ['alice', 'admin']) {
      const visible = (await asUser(actor, 'select checked_in_at,checked_in_by,food_redeemed_at,food_redeemed_by from public.issued_tickets where id=$1', [tickets[0].id])).rows[0];
      assert.deepEqual(visible, { checked_in_at: entry.checked_in_at, checked_in_by: users.staff, food_redeemed_at: food.food_redeemed_at, food_redeemed_by: users.admin });
    }
    const second = (await asUser('alice', 'select checked_in_at,food_redeemed_at from public.issued_tickets where id=$1', [tickets[1].id])).rows[0];
    assert.deepEqual(second, { checked_in_at: null, food_redeemed_at: null });
    assert.equal((await scan(tickets[1].token)).result, 'success');
    assert.equal((await scan(tickets[1].token, 'food')).result, 'success');
    assert.equal(scalar(await asUser('bob', 'select count(*) from public.issued_tickets')), 0);
  });

  test('food is blocked until entry and rejected scans do not consume either use', async () => {
    await assignStaff();
    const order = await submit();
    await review(order.id);
    const token = scalar(await db.query('select token from public.issued_tickets'), 'token');
    const first = await scan(token, 'food');
    assert.equal(first.result, 'entry_required');
    assert.equal(first.checked_in_at, null);
    assert.equal(first.food_redeemed_at, null);
    assert.deepEqual((await db.query('select checked_in_by,food_redeemed_by from public.issued_tickets')).rows, [{ checked_in_by: null, food_redeemed_by: null }]);
    assert.equal((await scan(token)).result, 'success');
    assert.equal((await scan(token, 'food')).result, 'success');
  });

  test('invalid, wrong-event, and unapproved tickets expose no guest data and cannot be consumed', async () => {
    await assignStaff();
    const order = await submit();
    await review(order.id);
    const token = scalar(await db.query('select token from public.issued_tickets'), 'token');
    for (const mode of ['entry', 'food']) {
      for (const invalid of [randomUUID(), null]) {
        const result = await scan(invalid, mode);
        assert.equal(result.result, 'invalid_ticket');
        assert.ok(Object.entries(result).every(([key, value]) => key === 'result' || value === null));
      }
      const wrong = await scan(token, mode, '10000000-0000-4000-8000-000000000002');
      assert.equal(wrong.result, 'wrong_event');
      assert.ok(Object.entries(wrong).every(([key, value]) => key === 'result' || value === null));
    }
    const pending = await submit('bob');
    const pendingToken = randomUUID();
    await db.query('insert into public.issued_tickets(order_id,seat_number,token) values ($1,1,$2)', [pending.id, pendingToken]);
    for (const status of ['pending', 'rejected']) {
      await db.query('update public.ticket_orders set status=$1 where id=$2', [status, pending.id]);
      const result = await scan(pendingToken);
      assert.equal(result.result, 'invalid_ticket');
      assert.ok(Object.entries(result).every(([key, value]) => key === 'result' || value === null));
    }
    assert.equal(scalar(await db.query('select count(*) from public.issued_tickets where checked_in_at is not null or food_redeemed_at is not null')), 0);
  });

  test('scan RPC rejects unauthorized callers and malformed modes even when the token is valid', async () => {
    await assignStaff();
    const order = await submit();
    await review(order.id);
    const token = scalar(await db.query('select token from public.issued_tickets'), 'token');
    await denied(() => asRole('anon', null, 'select * from public.scan_ticket($1,$2,$3)', [token, 'entry', eventId]));
    await assert.rejects(() => scan(token, 'entry', eventId, 'alice'), /Staff access required/);
    await assert.rejects(() => asUser('staff', 'select public.check_in_ticket($1)', [token]), /Admin access required/);
    for (const mode of [null, '', 'exit', 'ENTRY']) await assert.rejects(() => scan(token, mode), /Invalid scan mode/);
    await assert.rejects(() => scan(token, 'entry', null), /Choose an event/);
    assert.equal(scalar(await db.query('select checked_in_at from public.issued_tickets'), 'checked_in_at'), null);
  });

  test('deleted events keep issued tickets usable and migration reruns preserve roles and both scan records', async () => {
    await assignStaff();
    const order = await submit();
    await review(order.id);
    await asUser('admin', 'select public.delete_ticket_event($1)', [eventId]);
    const token = scalar(await db.query('select token from public.issued_tickets'), 'token');
    assert.equal((await scan(token)).result, 'success');
    assert.equal((await scan(token, 'food')).result, 'success');
    const beforeTicket = (await db.query('select * from public.issued_tickets')).rows;
    const beforeStaff = (await db.query('select * from public.ticket_staff')).rows;
    await db.exec(await readFile(new URL('../supabase/migrations/004_staff_scanning.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select * from public.issued_tickets')).rows, beforeTicket);
    assert.deepEqual((await db.query('select * from public.ticket_staff')).rows, beforeStaff);
    assert.equal((await scan(token)).result, 'already_used');
    assert.equal((await scan(token, 'food')).result, 'already_used');
    assert.equal(scalar(await asUser('admin', 'select public.check_in_ticket($1) as checked', [token]), 'checked'), false);
  });
});

describe('ticket-backed contest voting', () => {
  test('seeds one campaign and 21 ordered contenders with public-safe fields and local assets', async () => {
    const campaigns = (await asRole('anon', null, 'select * from public.voting_campaigns')).rows;
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].id, campaignId);
    assert.equal(campaigns[0].event_id, contestEventId);
    assert.equal(campaigns[0].eyebrow, 'Elimination rounds');
    assert.equal(campaigns[0].headline, 'TOP 21 Official Contenders');
    assert.equal(campaigns[0].title, 'Spectra’s Next Singing Idol');
    assert.equal(campaigns[0].hero_url, '/assets/reference/contest-top21.jpg');
    const contenders = (await asRole('anon', null,
      'select id,number,name,image_url,position from public.contestants order by position')).rows;
    assert.equal(contenders.length, 21);
    assert.deepEqual(contenders[0], {
      id: contenderId, number: 1, name: 'Contender 01', image_url: '/assets/contest/c01.jpg', position: 1,
    });
    assert.deepEqual(contenders.at(-1), {
      id: '31000000-0000-4000-8000-000000000021', number: 21, name: 'Contender 21', image_url: '/assets/contest/c21.jpg', position: 21,
    });
    assert.deepEqual(Object.keys((await asRole('anon', null, 'select * from public.contest_public_tally($1) limit 1', [campaignId])).rows[0]).sort(),
      ['description', 'id', 'image_url', 'name', 'number', 'position', 'share_percent', 'vote_count']);
  });

  test('one vote consumes one approved issued ticket, including unchecked tickets, until quantity is exhausted', async () => {
    await approveTickets('alice', 3);
    assert.deepEqual(await voteStatus(), { eligible: 3, used: 0, remaining: 3 });
    const first = await castVote();
    const second = await castVote('alice', '31000000-0000-4000-8000-000000000002');
    const third = await castVote();
    assert.equal(first.remaining, 2);
    assert.equal(second.remaining, 1);
    assert.equal(third.remaining, 0);
    assert.equal(new Set([first.issued_ticket_id, second.issued_ticket_id, third.issued_ticket_id]).size, 3);
    assert.equal(scalar(await db.query('select count(*) from public.issued_tickets where checked_in_at is not null')), 0);
    assert.deepEqual(await voteStatus(), { eligible: 3, used: 3, remaining: 0 });
    await assert.rejects(() => castVote(), /No unused eligible ticket remains/);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_votes')), 3);
  });

  test('simultaneous vote attempts cannot count one ticket twice', async () => {
    await approveTickets('alice', 1);
    const attempts = await Promise.allSettled([
      castVote('alice', contenderId),
      castVote('alice', '31000000-0000-4000-8000-000000000002'),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
    assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /No unused eligible ticket remains/);
    assert.equal(scalar(await db.query('select count(*) from public.ticket_votes')), 1);
    assert.equal(scalar(await db.query('select count(distinct issued_ticket_id) from public.ticket_votes')), 1);
  });

  test('eligibility is isolated by event and excludes pending, rejected, anonymous, and unconfirmed users', async () => {
    await approveTickets('alice', 2, eventId);
    assert.deepEqual(await voteStatus(), { eligible: 0, used: 0, remaining: 0 });
    await assert.rejects(() => castVote(), /No unused eligible ticket remains/);

    const pending = await submit('bob', { eventId: contestEventId });
    await db.query('insert into public.issued_tickets(order_id,seat_number) values ($1,1)', [pending.id]);
    assert.deepEqual(await voteStatus('bob'), { eligible: 0, used: 0, remaining: 0 });
    await assert.rejects(() => castVote('bob'), /No unused eligible ticket remains/);
    await db.query("update public.ticket_orders set status='rejected' where id=$1", [pending.id]);
    await assert.rejects(() => castVote('bob'), /No unused eligible ticket remains/);

    await denied(() => asRole('anon', null, 'select * from public.cast_contest_vote($1,$2)', [campaignId, contenderId]));
    await denied(() => asRole('anon', null, 'select * from public.contest_vote_status($1)', [campaignId]));
    await assert.rejects(() => castVote('unconfirmed'), /Confirm your email first/);
  });

  test('campaign state and time window close voting without discarding public results', async () => {
    await approveTickets();
    await asUser('admin', "update public.voting_campaigns set opens_at=now()+interval '1 hour' where id=$1", [campaignId]);
    await assert.rejects(() => castVote(), /Voting is not open/);
    await asUser('admin', "update public.voting_campaigns set opens_at=now()-interval '2 hours',closes_at=now()-interval '1 hour' where id=$1", [campaignId]);
    await assert.rejects(() => castVote(), /Voting is not open/);
    await asUser('admin', 'update public.voting_campaigns set opens_at=null,closes_at=null,active=false where id=$1', [campaignId]);
    await assert.rejects(() => castVote(), /Voting is not open/);
    assert.equal((await asRole('anon', null, 'select id from public.voting_campaigns where id=$1', [campaignId])).rows.length, 0);
    assert.equal((await asRole('anon', null, 'select * from public.contest_public_tally($1)', [campaignId])).rows.length, 0);
    await assert.rejects(() => asUser('admin', "update public.voting_campaigns set opens_at=now(),closes_at=now()-interval '1 minute' where id=$1", [campaignId]), /voting_campaigns_check/);
  });

  test('contestants cannot cross campaigns and voted relationships cannot be reassigned', async () => {
    const otherCampaign = randomUUID();
    const otherContestant = randomUUID();
    await asUser('admin', "insert into public.voting_campaigns(id,event_id,title) values ($1,$2,'Other vote')", [otherCampaign, eventId]);
    await asUser('admin', "insert into public.contestants(id,campaign_id,number,name,image_url) values ($1,$2,1,'Other contender','https://example.com/other.jpg')", [otherContestant, otherCampaign]);
    await approveTickets('alice', 1, eventId);
    await assert.rejects(() => castVote('alice', contenderId, otherCampaign), /Contestant is not available/);
    const vote = await castVote('alice', otherContestant, otherCampaign);
    assert.equal(vote.contestant_id, otherContestant);
    await assert.rejects(() => asUser('admin', 'update public.voting_campaigns set event_id=$1 where id=$2', [contestEventId, otherCampaign]), /cannot change events/);
    await assert.rejects(() => asUser('admin', 'update public.contestants set campaign_id=$1 where id=$2', [campaignId, otherContestant]), /cannot change campaigns/);
  });

  test('vote rows are private, immutable, and cannot be inserted directly even by admins', async () => {
    await approveTickets();
    const vote = await castVote();
    assert.equal(scalar(await asUser('alice', 'select count(*) from public.ticket_votes')), 1);
    assert.equal(scalar(await asUser('bob', 'select count(*) from public.ticket_votes')), 0);
    assert.equal(scalar(await asUser('admin', 'select count(*) from public.ticket_votes')), 1);
    await denied(() => asRole('anon', null, 'select * from public.ticket_votes'));
    for (const actor of ['alice', 'admin']) {
      await denied(() => asUser(actor,
        'insert into public.ticket_votes(campaign_id,contestant_id,issued_ticket_id,user_id) values ($1,$2,$3,$4)',
        [campaignId, contenderId, vote.issued_ticket_id, users[actor]]));
      await denied(() => asUser(actor, 'update public.ticket_votes set contestant_id=$1', ['31000000-0000-4000-8000-000000000002']));
      await denied(() => asUser(actor, 'delete from public.ticket_votes'));
    }
    await assert.rejects(() => db.query('update public.ticket_votes set contestant_id=$1 where id=$2',
      ['31000000-0000-4000-8000-000000000002', vote.vote_id]), /Votes are immutable/);
    await assert.rejects(() => db.query('delete from public.ticket_votes where id=$1', [vote.vote_id]), /Votes are immutable/);
  });

  test('public tally exposes aggregate totals and shares, then hides every result field on demand', async () => {
    await approveTickets('alice', 2);
    await castVote();
    await castVote('alice', '31000000-0000-4000-8000-000000000002');
    const visible = (await asRole('anon', null, 'select * from public.contest_public_tally($1)', [campaignId])).rows;
    assert.equal(visible.length, 21);
    assert.equal(visible.reduce((sum, row) => sum + row.vote_count, 0), 2);
    assert.equal(visible.find((row) => row.number === 1).share_percent, '50.00');
    assert.equal(visible.find((row) => row.number === 2).share_percent, '50.00');
    assert.equal(visible.find((row) => row.number === 3).share_percent, '0.00');

    await asUser('admin', 'update public.voting_campaigns set results_visible=false where id=$1', [campaignId]);
    const hidden = (await asRole('anon', null, 'select * from public.contest_public_tally($1)', [campaignId])).rows;
    assert.equal(hidden.length, 21);
    assert.ok(hidden.every((row) => row.vote_count === null && row.share_percent === null));
    const adminHidden = (await asUser('admin', 'select * from public.contest_public_tally($1)', [campaignId])).rows;
    assert.equal(adminHidden.reduce((sum, row) => sum + row.vote_count, 0), 2);
    assert.equal(adminHidden.find((row) => row.number === 1).share_percent, '50.00');

    await asUser('admin', 'update public.voting_campaigns set results_visible=true where id=$1', [campaignId]);
    await asUser('admin', 'update public.contestants set active=false where number=1 and campaign_id=$1', [campaignId]);
    const publicRows = (await asRole('anon', null, 'select * from public.contest_public_tally($1)', [campaignId])).rows;
    const adminRows = (await asUser('admin', 'select * from public.contest_public_tally($1)', [campaignId])).rows;
    assert.equal(publicRows.length, 20);
    assert.equal(publicRows.reduce((sum, row) => sum + row.vote_count, 0), 1);
    assert.equal(adminRows.length, 21);
    assert.equal(adminRows.reduce((sum, row) => sum + row.vote_count, 0), 2);
  });

  test('only admins manage campaigns and contestants; staff may vote solely with their own ticket', async () => {
    await assignStaff();
    const newCampaign = randomUUID();
    const newContestant = randomUUID();
    await assert.rejects(() => asUser('alice', "insert into public.voting_campaigns(id,event_id,title) values ($1,$2,'Injected')", [newCampaign, eventId]), /row-level security/);
    assert.equal((await asUser('staff', "update public.voting_campaigns set title='Staff edit' returning id")).rows.length, 0);
    await asUser('admin', "insert into public.voting_campaigns(id,event_id,title,hero_url) values ($1,$2,'Admin campaign','https://example.com/hero.jpg')", [newCampaign, eventId]);
    await asUser('admin', "insert into public.contestants(id,campaign_id,number,name,image_url) values ($1,$2,1,'Admin contender','/assets/contest/c01.jpg')", [newContestant, newCampaign]);
    await asUser('admin', "update public.contestants set name='Edited contender' where id=$1", [newContestant]);
    assert.equal(scalar(await db.query('select name from public.contestants where id=$1', [newContestant]), 'name'), 'Edited contender');
    await assert.rejects(() => asUser('admin', "update public.voting_campaigns set hero_url='javascript:alert(1)' where id=$1", [newCampaign]), /voting_campaigns_hero_url_check/);
    await assert.rejects(() => asUser('admin', 'update public.contestants set number=0 where id=$1', [newContestant]), /contestants_number_check/);

    await assert.rejects(() => castVote('staff'), /No unused eligible ticket remains/);
    await approveTickets('staff');
    assert.equal((await castVote('staff')).remaining, 0);
    assert.equal(scalar(await asUser('staff', 'select count(*) from public.ticket_votes')), 1);
    await asUser('admin', 'delete from public.contestants where id=$1', [newContestant]);
    await asUser('admin', 'delete from public.voting_campaigns where id=$1', [newCampaign]);
  });

  test('rerunning 005 preserves votes, hidden settings, and edited contestant content', async () => {
    await approveTickets();
    const vote = await castVote();
    await asUser('admin', "update public.voting_campaigns set title='Production title',results_visible=false where id=$1", [campaignId]);
    await asUser('admin', "update public.contestants set name='Finalist One' where id=$1", [contenderId]);
    await db.exec(await readFile(new URL('../supabase/migrations/005_ticket_voting.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select id,contestant_id,issued_ticket_id,user_id from public.ticket_votes')).rows, [{
      id: vote.vote_id, contestant_id: contenderId, issued_ticket_id: vote.issued_ticket_id, user_id: users.alice,
    }]);
    assert.deepEqual((await db.query('select title,results_visible from public.voting_campaigns where id=$1', [campaignId])).rows,
      [{ title: 'Production title', results_visible: false }]);
    assert.equal(scalar(await db.query('select name from public.contestants where id=$1', [contenderId]), 'name'), 'Finalist One');
    assert.equal(scalar(await db.query('select count(*) from public.contestants where campaign_id=$1', [campaignId])), 21);
  });
});

describe('notification queue delivery claims', () => {
  test('only the service role can claim; fresh locks and sent records prevent duplicate delivery', async () => {
    await submit();
    const notification = (await db.query('select * from public.ticket_notifications')).rows[0];
    for (const role of ['anon', 'authenticated']) {
      await denied(() => asRole(role, role === 'authenticated' ? users.admin : null,
        'select * from public.claim_ticket_email($1)', [notification.id]));
    }
    const claim = () => asRole('service_role', null, 'select * from public.claim_ticket_email($1)', [notification.id]);
    const first = (await claim()).rows[0];
    assert.equal(first.state, 'sending');
    assert.equal(first.attempts, 1);
    assert.ok(first.locked_at);
    assert.equal((await claim()).rows.length, 0);
    await asRole('service_role', null, "update public.ticket_notifications set state='sent',sent_at=now(),provider_id='email-test' where id=$1", [notification.id]);
    assert.equal((await claim()).rows.length, 0);
    assert.equal((await asRole('service_role', null, 'select * from public.claim_ticket_email($1)', [randomUUID()])).rows.length, 0);
  });

  test('failed and expired claims can retry, up to the ten-attempt limit', async () => {
    await submit();
    const { id } = (await db.query('select id from public.ticket_notifications')).rows[0];
    const claim = () => asRole('service_role', null, 'select * from public.claim_ticket_email($1)', [id]);
    await claim();
    await db.query("update public.ticket_notifications set locked_at=now()-interval '11 minutes' where id=$1", [id]);
    assert.equal((await claim()).rows[0].attempts, 2);
    await db.query("update public.ticket_notifications set state='failed',last_error='Test delivery failed' where id=$1", [id]);
    assert.equal((await claim()).rows[0].attempts, 3);
    await db.query("update public.ticket_notifications set state='failed',attempts=9 where id=$1", [id]);
    assert.equal((await claim()).rows[0].attempts, 10);
    await db.query("update public.ticket_notifications set state='failed' where id=$1", [id]);
    assert.equal((await claim()).rows.length, 0);
  });

  test('only admins can requeue exhausted failures; sent records and active delivery locks stay untouched', async () => {
    const failed = await submit();
    const locked = await submit();
    const sent = await submit('bob');
    const retrying = await submit('bob');
    await db.query("update public.ticket_notifications set state='failed',attempts=10,last_error='Delivery failed' where order_id=$1", [failed.id]);
    await db.query("update public.ticket_notifications set state='sending',attempts=10,locked_at=now() where order_id=$1", [locked.id]);
    await db.query("update public.ticket_notifications set state='sent',attempts=10,sent_at=now() where order_id=$1", [sent.id]);
    await db.query("update public.ticket_notifications set state='failed',attempts=4,last_error='Temporary failure' where order_id=$1", [retrying.id]);
    await denied(() => asRole('anon', null, 'select public.requeue_ticket_emails($1)', [failed.id]));
    await assert.rejects(() => asUser('alice', 'select public.requeue_ticket_emails($1)', [failed.id]), /Admin access required/);
    await asUser('admin', 'select public.requeue_ticket_emails($1)', [failed.id]);
    assert.deepEqual((await db.query('select state,attempts,locked_at,last_error from public.ticket_notifications where order_id=$1', [failed.id])).rows,
      [{ state: 'queued', attempts: 0, locked_at: null, last_error: null }]);
    await asUser('admin', 'select public.requeue_ticket_emails()');
    assert.equal(scalar(await db.query('select state from public.ticket_notifications where order_id=$1', [locked.id]), 'state'), 'sending');
    assert.equal(scalar(await db.query('select state from public.ticket_notifications where order_id=$1', [sent.id]), 'state'), 'sent');
    assert.equal(scalar(await db.query('select attempts from public.ticket_notifications where order_id=$1', [retrying.id]), 'attempts'), 4);
    await db.query("update public.ticket_notifications set locked_at=now()-interval '11 minutes' where order_id=$1", [locked.id]);
    await asUser('admin', 'select public.requeue_ticket_emails()');
    assert.deepEqual((await db.query('select state,attempts from public.ticket_notifications where order_id=$1', [locked.id])).rows,
      [{ state: 'queued', attempts: 0 }]);
  });
});
