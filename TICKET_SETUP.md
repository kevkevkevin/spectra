# Spectra ticketing setup

Apply any missing migrations in numerical order through `008_contest_scoring_rounds.sql`. The final migration adds separate Elimination, Semi-finals, and Grand Finals scoring while preserving existing judge scores as Elimination results. Ticket notification emails still require the server credentials below.

## 1. Install the database

For a fresh installation, run `supabase/migrations/002_ticketing.sql` once in the Supabase SQL Editor **after** `001_content.sql`. It creates events, payment settings, private receipts, orders, issued tickets, and an email queue, with row-level security and restricted database functions.

For this existing project, run `supabase/migrations/003_event_management.sql` next. It adds event banners, event deletion, and bookings without date restrictions. On its first application, it opens existing events and enables the saved payment instructions when a payment method is present. It preserves edited event details and existing orders. Rerunning this migration preserves subsequent manual pauses and deleted events.

Then run `supabase/migrations/004_staff_scanning.sql`. It adds the admin-managed Staff role, one-time event-entry and food-redemption records, role-protected scanner functions, and status fields visible to each ticket owner and admins.

Then run `supabase/migrations/005_ticket_voting.sql`. It creates voting campaigns, contestant profiles, immutable ticket votes, private voter records, and public aggregate tallies. It also seeds the Spectra’s Next Singing Idol campaign and 21 editable contender profiles.

Next, run `supabase/migrations/006_deployment_hardening.sql`. It aligns the existing receipt and banner buckets with the app's 4 MB upload limit so uploads fit within Vercel's request-body ceiling.

Then run `supabase/migrations/007_contest_tabulation.sql`. It creates judge roles, seven editable scoring criteria per campaign, private scorecards, a weighted leaderboard function, and controls for scoring and public visibility.

Finally, run `supabase/migrations/008_contest_scoring_rounds.sql`. It adds three scoring rounds, migrates existing scorecards to Elimination, and lets admins select the contenders who advance to Semi-finals and Grand Finals. Each round has independent scoring and public-result controls. These upgrades are transactional and safe to rerun; reruns preserve votes, scores, and admin edits.

If `001_content.sql` already ran, do not run it again. The new migration is transactional. If it fails, resolve the error before retrying; do not remove the access policies to make it pass.

## 2. Enable customer registration

In Supabase Authentication, enable email/password sign-ups and email confirmation. Set the Site URL to your deployed website origin. Add the same origin's `/auth/confirm` route to the allowed redirect URLs. For local testing, use `http://localhost:3000` and allow `http://localhost:3000/auth/confirm` (including its query parameters).

Set `SITE_URL` in the app to that same origin. It is used for confirmation links, admin email links, and ticket QR codes. Before production, replace the localhost value in the hosting environment.

For confirmation that works when opened on another device, set the **Confirm signup** email template to:

```html
<h2>Welcome to Spectra</h2>
<p>Confirm your email to book your next night.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/tickets">Confirm my email</a></p>
```

The default PKCE confirmation flow is also supported via the `code` parameter. Supabase sends authentication emails separately from the ticket notification integration. Configure custom SMTP in Supabase for real customer email delivery; the built-in mail service is restricted and intended for testing.

Create and confirm the site owner's account at `/signup`, then grant that first account the Admin role once using its UUID from Authentication → Users:

```sql
insert into public.admins (user_id)
values ('REPLACE_WITH_STAFF_USER_UUID'::uuid)
on conflict (user_id) do nothing;
```

Sign in as that admin and open `/admin/staff`. Search for any registered user by name or email, then choose **Make staff** or **Remove staff**. Staff can use the entry and food scanner, but cannot approve orders, view receipts, edit payment/event information, assign roles, or access the customer directory. Customers cannot assign themselves permissions. The notification recipient address does not automatically receive admin privileges.

## 3. Configure ticket emails

Use a Resend account with a verified sending domain. Set these **server-only** environment variables locally and on the hosting platform:

```dotenv
SITE_URL=https://YOUR_DEPLOYED_WEBSITE
ADMIN_NOTIFICATION_EMAIL=admin@example.com
EMAIL_FROM=Spectra <tickets@YOUR_VERIFIED_DOMAIN>
RESEND_API_KEY=YOUR_RESEND_API_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SUPABASE_SECRET_KEY
```

The legacy `SUPABASE_SERVICE_ROLE_KEY` variable is supported if your project uses that key instead. Never use a privileged key in a `NEXT_PUBLIC_` variable. The privileged client is used only to read and deliver the persisted notification queue. Customer and staff actions use authenticated clients and database permissions.

- On submission: the admin receives a review link. Receipts and customer contact information are not included in the admin email; they are visible after an admin signs in.
- On approval/rejection: the customer receives the decision, staff message, and account link.
- A provider outage never rolls back an order or a decision. The queue records failures. Use **Retry emails** in `/admin/tickets`, or **Retry unsent emails** on an individual request.
- `sent` means the email provider accepted the message, not that it reached the inbox. Check the Resend dashboard for bounces/delivery events.
- Automatic attempts stop after 10 failures. An admin retry resets exhausted failed attempts. Delivery uses Resend idempotency keys; retries outside the provider's retention window can result in duplicate email, without duplicating an order or ticket.

For unattended retries, optionally configure an external scheduler to POST to `/api/notifications` with `Authorization: Bearer <NOTIFICATION_CRON_SECRET>`. Set a long random `NOTIFICATION_CRON_SECRET` in the hosting environment first. The endpoint processes up to 20 queued items per pass. No scheduler is installed automatically.

## 4. Confirm events and payment details

Visit `/admin/tickets/settings` while signed in as an admin:

1. Edit the payee, STC Pay number, optional bank details, and payment instructions in the always-expanded payment form. The saved STC Pay number is `050 863 4546`. The **Accept ticket purchases** checkbox controls payment collection globally.
2. Edit each event's title, description, location, optional date, price, capacity, and banner. All date inputs use Saudi time (UTC+03:00). Upload a PNG/JPEG/WebP banner up to 4 MB or supply an HTTPS image URL. Banners are public; payment receipts remain private.
3. New events default to **Open for bookings**. A missing or past event date does not close sales. Admins can pause an event or all purchases using the checkboxes.
4. **Delete event** removes it from sale after confirming the checkbox. Existing requests, approved tickets, and QR check-in remain available. Deleted events cannot accept new purchases.

Create a separate event for each performance date. The app accepts proof of a manual transfer; it does not charge a card, verify a transfer automatically, or issue refunds. Do not treat a receipt image alone as proof that funds reached the correct account.

The public page hides payment instructions for unavailable quantities. Pending and approved requests count against capacity. Seats are reserved **when a request is submitted**, not while a visitor is making an external transfer. The final seat may be taken during payment; the customer is instructed to contact Spectra if that occurs. Admins should promptly resolve pending requests. Existing orders preserve their original date, venue and price when an event is edited.

## 5. Workflow and door entry

1. Customer signs up and confirms email, then signs in.
2. Customer chooses an available event and quantity (1–10), pays using the displayed instructions, uploads a PNG/JPEG/WebP receipt up to 4 MB, and submits.
3. The request and admin notification are committed together. The customer sees `Awaiting approval` in `/account`; the admin sees the request in `/admin/tickets`.
4. An admin opens the private receipt, verifies the transaction in the payment account, then approves or rejects. Approval requires a payment-verification checkbox; rejection requires an explanation.
5. The customer dashboard checks for changes every 15 seconds while visible. A refresh button is also available. Decisions cannot be changed after review in this version.
6. Approval creates one QR ticket per guest. Staff opens `/staff/scan` over HTTPS, grants browser camera permission, chooses the event and **Event entry**, then scans the QR with the phone camera, a QR image, or its ticket link. The scanner confirms the result before the guest is admitted.
7. At the food counter, staff switches to **Food counter** and scans the same QR. Food is available only after entry and can be redeemed once. Repeated scans report the original status without creating another entry or meal.
8. The staff scanner shows an immediate result dialog. A guest with their account or ticket page open receives a success message within about three seconds. Guests and admins see persistent entry and food statuses with Saudi timestamps. Merely opening a QR link never consumes either use.

## 6. Contest voting

Open `/admin/voting` as an admin after migration 005 is applied. The seeded campaign is linked to the Singing Idol ticket event and starts active with the public tally visible. From this page you can:

1. Edit the campaign heading, introduction, prize, hero image, Saudi voting window, and linked ticket event.
2. Pause or reopen voting independently of ticket sales.
3. Show or hide public vote totals.
4. Edit every contender’s name, number, description, image, and ballot position, add contenders, or deactivate a profile without deleting vote history.

The public ballot is `/contest`. A confirmed, signed-in customer receives one final vote for each issued ticket from an approved order for the campaign’s linked event. A quantity of three therefore provides three votes. The database spends a different issued ticket for each vote and rejects repeat or simultaneous attempts to reuse one. Entry and food scans do not affect voting eligibility. Pending and rejected orders cannot vote.

Voting records cannot be edited or deleted through the app. Once the first vote is cast, the campaign cannot be moved to another event and voted contenders cannot be moved to another campaign. Create a new campaign for a later voting round. When public results are hidden, visitors see the lineup without totals or percentages while admins can still monitor the tally in `/admin/voting`.

## 7. Judge tabulation

After migration 008, open `/admin/tabulation` as an admin. Registered users can be assigned the **Judge** role there. Judges sign in and use `/judge` to submit a separate complete scorecard for each eligible contender in each open round. Their access does not include ticket approvals, staff assignment, private receipts, or campaign editing.

The default rubric has seven subcriteria: three for **Voice quality (50%)**, two for **Stage presence (30%)**, and two for **Audience impact (20%)**. Admins can rename them and set custom whole-percentage subweights while preserving each category total. The same rubric applies to all rounds and locks as soon as the first scorecard is submitted. Each judge rates each subcriterion from 0 to 10, with up to two decimal places. A subcriterion contributes `rating ÷ 10 × subweight` points; the seven contributions total at most 100. Each contender's score is the average of completed judge scorecards **for that round only**. Scores do not carry over. Ties are ordered by voice, then stage, then impact. Partial judging is provisional and the leaderboard shows the number of judges who have scored each contender.

Start with Elimination. Close that round, select contenders who have been scored there, then open Semi-finals. Repeat to advance scored semifinalists to Grand Finals. Only one round may be open at a time. Advancing lists lock once their round opens. Judges can revise their own scorecards while scoring is open; a revision replaces their previous scores without adding another judge to the average. The admin leaderboard refreshes every five seconds. **Show results publicly** is controlled separately for each round on `/contest/results`; public judge results are hidden by default. Ticket-backed audience votes on `/contest` remain a separate tally; Audience Impact here is scored by judges.

Signed receipt URLs expire after 5 minutes for customers and 10 minutes for admins. Refresh the page to generate a new link. Customers cannot overwrite or delete a receipt once it is attached to an order.

## Validation

Run `npm run build` for the full production/TypeScript check, and `npm test` for the isolated PostgreSQL, notification, protected status API, real QR encode/decode, and ticket-backed voting tests. These do not contact or alter the live project. They verify staff assignment and revocation, private customer data, both scan counters, duplicate scans, event matching, undated bookings, voting eligibility, concurrent vote attempts, hidden tallies, migration reruns, and QR parsing. Before launch, complete one real end-to-end booking with a test customer, approve it, cast its vote, scan entry and food on separate signed-in devices, and verify the status messages on the guest and admin screens.

References: [Supabase server-side clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Resend sending API](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
