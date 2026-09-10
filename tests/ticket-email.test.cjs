const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const configuredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-server-secret',
  RESEND_API_KEY: 'test-email-secret',
  EMAIL_FROM: 'Spectra <tickets@example.com>',
  ADMIN_NOTIFICATION_EMAIL: 'admin@example.com',
  SITE_URL: 'https://spectra.example.com',
};
const booking = {
  id: '8fa953b1-5465-45fc-a2e3-98dfb26aebf8',
  user_id: '030e0442-2ae0-4201-b4d9-cf5f097504aa',
  customer_name: 'Ticket Guest',
  customer_email: 'guest@example.net',
  customer_phone: '+966500000000',
  event_title: 'Spectra Live Night',
  event_starts_at: '2027-01-15T18:00:00.000Z',
  event_venue: 'Spectra stage',
  quantity: 2,
  total_minor: 10000,
  receipt_path: 'private-owner/private-order/confidential-payment.png',
  note: 'Private customer payment details',
  review_note: '',
};

// Transpile the actual application module without importing Next.js or server-only
// into Node's test runner. Every external capability is provided by the harness.
function loadTypeScript(relativePath, imports, globals = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  });
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    },
    AbortSignal, Date, Error, Intl, URL,
    ...globals,
  });
  new vm.Script(outputText, { filename: relativePath }).runInContext(context);
  return module.exports;
}

function harness({ kind = 'submitted', env = {}, responses = [], order = {}, state = 'queued' } = {}) {
  const settings = { ...configuredEnv, ...env };
  const currentOrder = { ...booking, ...order };
  const notification = {
    id: '9387e1ae-f3a3-4ad9-9ba5-26f67612217a',
    order_id: currentOrder.id,
    kind, state, attempts: 0, last_error: null,
  };
  const tables = { ticket_notifications: [notification], ticket_orders: [currentOrder] };
  const requests = [];
  const writes = [];
  const clientCalls = [];
  let responseIndex = 0;

  function query(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
    const predicates = [];
    let patch;
    let limit = Infinity;
    const execute = () => {
      const rows = tables[table].filter(row => predicates.every(filter => filter(row))).slice(0, limit);
      if (patch) {
        writes.push({ table, ids: rows.map(row => row.id), values: plain(patch) });
        rows.forEach(row => Object.assign(row, plain(patch)));
      }
      return { data: plain(rows), error: null };
    };
    const chain = {
      select() { return chain; },
      neq(key, value) { predicates.push(row => row[key] !== value); return chain; },
      lt(key, value) { predicates.push(row => row[key] < value); return chain; },
      eq(key, value) { predicates.push(row => row[key] === value); return chain; },
      order() { return chain; },
      limit(value) { limit = value; return chain; },
      update(values) { patch = values; return chain; },
      async single() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return chain;
  }
  const db = {
    from: query,
    async rpc(name, args) {
      assert.equal(name, 'claim_ticket_email');
      assert.equal(args.p_id, notification.id);
      if (!['queued', 'failed'].includes(notification.state) || notification.attempts >= 10) {
        return { data: [], error: null };
      }
      notification.state = 'sending';
      notification.attempts += 1;
      return { data: [plain(notification)], error: null };
    },
  };
  const tickets = loadTypeScript('lib/tickets.ts', {});
  const email = loadTypeScript('lib/ticket-email.ts', {
    'server-only': {},
    '@supabase/supabase-js': {
      createClient(...args) { clientCalls.push(args); return db; },
    },
    './customer': { siteUrl: () => new URL(settings.SITE_URL).origin },
    './tickets': tickets,
  }, {
    process: { env: settings },
    async fetch(url, options) {
      requests.push({ url, method: options.method, headers: plain(options.headers), body: JSON.parse(options.body) });
      const next = responses[responseIndex++] ?? { status: 200, body: { id: 'provider-message-123' } };
      if (next.error) throw next.error;
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    },
  });
  return { email, notification, requests, writes, clientCalls, currentOrder };
}

test('missing delivery configuration performs no database work or email request', async () => {
  const h = harness({ env: { RESEND_API_KEY: '' } });
  assert.equal(h.email.emailConfigured(), false);
  assert.deepEqual(plain(await h.email.dispatchTicketEmails()), { sent: 0, failed: 0, configured: false });
  assert.equal(h.clientCalls.length, 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.notification.state, 'queued');
  assert.equal(h.notification.attempts, 0);
});

test('submission emails notify the admin through a protected review link without exposing receipts', async () => {
  const h = harness();
  assert.deepEqual(plain(await h.email.dispatchTicketEmails(booking.id)), { sent: 1, failed: 0, configured: true });
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body.to, ['admin@example.com']);
  assert.equal(request.body.from, configuredEnv.EMAIL_FROM);
  assert.match(request.body.subject, /awaiting review/);
  assert.ok(request.body.text.includes(`https://spectra.example.com/admin/tickets/${booking.id}`));
  assert.ok(request.body.text.includes('100 SAR'));
  assert.ok(request.body.text.includes('Quantity: 2'));
  assert.ok(!JSON.stringify(request.body).includes(booking.receipt_path));
  assert.ok(!JSON.stringify(request.body).includes(booking.customer_phone));
  assert.ok(!JSON.stringify(request.body).includes(booking.note));
  assert.ok(!Object.hasOwn(request.body, 'attachments'));
  assert.deepEqual(plain(h.clientCalls[0]), [configuredEnv.NEXT_PUBLIC_SUPABASE_URL, configuredEnv.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }]);
});

for (const kind of ['approved', 'rejected']) {
  test(`${kind} decision emails go to the booking customer with the account link and review message`, async () => {
    const reviewNote = kind === 'approved' ? 'See you at the show.' : 'Please contact us about your payment.';
    const h = harness({ kind, order: { review_note: reviewNote } });
    await h.email.dispatchTicketEmails(booking.id);
    const message = h.requests[0].body;
    assert.deepEqual(message.to, ['guest@example.net']);
    assert.match(message.subject, new RegExp(kind));
    assert.ok(message.text.includes(reviewNote));
    assert.ok(message.text.includes(`https://spectra.example.com/account/orders/${booking.id}`));
    assert.ok(!message.text.includes('/admin/tickets/'));
    assert.ok(!message.text.includes(booking.receipt_path));
    assert.equal(message.text.includes('Your QR tickets are ready'), kind === 'approved');
  });
}

test('provider failure remains retryable, with the same idempotency key and durable success marking', async () => {
  const h = harness({ responses: [
    { status: 503, body: { message: 'Temporarily unavailable' } },
    { status: 200, body: { id: 'provider-retry-456' } },
  ] });
  assert.deepEqual(plain(await h.email.dispatchTicketEmails(booking.id)), { sent: 0, failed: 1, configured: true });
  assert.equal(h.notification.state, 'failed');
  assert.equal(h.notification.last_error, 'provider_http_503');
  assert.equal(h.notification.attempts, 1);
  assert.equal(h.notification.sent_at, undefined);
  assert.equal(h.notification.provider_id, undefined);
  assert.deepEqual(plain(await h.email.dispatchTicketEmails(booking.id)), { sent: 1, failed: 0, configured: true });
  assert.equal(h.notification.state, 'sent');
  assert.equal(h.notification.attempts, 2);
  assert.equal(h.notification.provider_id, 'provider-retry-456');
  assert.equal(h.notification.last_error, null);
  assert.ok(Number.isFinite(Date.parse(h.notification.sent_at)));
  assert.equal(h.requests[0].headers['Idempotency-Key'], `ticket-${h.notification.id}`);
  assert.equal(h.requests[1].headers['Idempotency-Key'], h.requests[0].headers['Idempotency-Key']);
  assert.deepEqual(h.requests[1].body, h.requests[0].body);
  assert.deepEqual(h.writes.map(write => write.values.state), ['failed', 'sent']);
  // A further retry does not send an already recorded success again.
  assert.deepEqual(plain(await h.email.dispatchTicketEmails(booking.id)), { sent: 0, failed: 0, configured: true });
  assert.equal(h.requests.length, 2);
});

test('a timeout stores a generic retry error without retaining sensitive exception text', async () => {
  const h = harness({ responses: [{ error: new Error('Network failed with private-provider-token') }] });
  assert.deepEqual(plain(await h.email.dispatchTicketEmails()), { sent: 0, failed: 1, configured: true });
  assert.equal(h.notification.state, 'failed');
  assert.equal(h.notification.last_error, 'delivery_failed');
  assert.ok(!JSON.stringify(h.writes).includes('private-provider-token'));
});

test('an email already claimed by another worker is not sent again', async () => {
  const h = harness({ state: 'sending' });
  assert.deepEqual(plain(await h.email.dispatchTicketEmails()), { sent: 0, failed: 0, configured: true });
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});
