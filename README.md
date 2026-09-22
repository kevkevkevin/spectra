# Spectra · Next.js + Supabase

Spectra rebuilt with Next.js App Router, TypeScript, React and Supabase. The homepage follows https://spectraproduction.grok.me/ with a full-viewport stage hero, a floating navigation bar, an editorial services sequence, artist portraits, event news and a cinematic WhatsApp enquiry form.

## Reference redesign

The primary brand color is violet-blue (`#663BFA`), defined by `--primary` in `app/site.css`. The responsive homepage refinements live in `app/homepage-refresh.css`: the hero uses the dynamic viewport height, services alternate imagery and copy, and the contact stage uses the local microphone artwork. The footer in `components/site-footer.tsx` uses circular SVG typography, a central booking invitation and an oversized Spectra wordmark that reveals the logo palette on hover or keyboard focus.

`components/scroll-motion.tsx` progressively adds one-time scroll reveals across the public, ticket and account experiences, plus gentle hero depth and scroll-driven footer lettering. Content stays visible without JavaScript, keyboard focus cancels an active reveal, and the system reduced-motion preference disables movement. No animation library is required.

Reference images are stored locally in `public/assets/reference`. Default roster, services and news are in `lib/site-content.ts`, captured from the reference on 7 September 2026. Published Supabase rows replace defaults within their category. The homepage story, event promotion and contact details are maintained in `components/landing.tsx`. This redesign requires no database migration.

The contest now lives at `/contest` with a Spectra-styled Top 21 page, ticket-backed ballot, final-vote confirmation, and optional live leaderboard. Judges use separate accounts at `/judge` to score seven weighted criteria in Elimination, Semi-finals, and Grand Finals. Admins choose advancing contenders, open each round, set custom subweights, and follow round-specific results at `/admin/tabulation`. The optional public judge leaderboard is at `/contest/results`. Tickets use the local `/tickets`, `/signup`, `/account`, and `/admin/tickets` workflow. See [TICKET_SETUP.md](TICKET_SETUP.md) for the required database migrations, email configuration, event setup, voting, and judge scoring controls. The contact form opens WhatsApp with a prepared enquiry for the visitor to review and send. It does not submit or store enquiries in Supabase. Local `/login` and `/admin` continue to use Supabase.

Verify the dated September 2026 event promotion before future publication. The reference identifies one performer only as “Featured Vocalist”; that name has been preserved.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The landing page works without credentials. `/login` explains the missing setup instead of failing.

## Connect Supabase

1. Create or select a Supabase project.
2. Copy `.env.example` to `.env.local`. Add your project URL and publishable key from the project Connect dialog. Do not put a service-role or secret key in either public variable; server-only notification credentials are described in TICKET_SETUP.md.
3. Run `supabase/migrations/001_content.sql` once in the project's SQL Editor.
4. Create and confirm the first owner account, then copy its UUID and grant Admin access in the SQL Editor:

```sql
insert into public.admins (user_id) values ('REPLACE_WITH_USER_UUID');
```

5. Apply the ticket migrations in order through `008_contest_scoring_rounds.sql`, restart the app, and sign in. Admins manage content, tickets, events, payments, voting, Staff roles, and judge tabulation. Assigned Staff can use only the entry and food scanner; assigned judges can score contestants.

Public customer registration is available at `/signup`. `/account` shows ticket requests, approved QR tickets, entry check-in, and food redemption. Customers vote at `/contest`, where each approved issued ticket for the linked event can be used once. Admins use `/admin/tickets` for receipt review, `/admin/voting` for campaign and contestant management, and `/admin/staff` to assign scanner access. Staff use `/staff/scan`. Password changes/account recovery can currently be managed by the project owner in Supabase.

## Content behavior

The `content_items` table stores talent, service and news entries. Only published rows appear publicly. If a category has no published entries, the original landing-page content appears. Publishing the first item replaces the original content for that category; publishing drafts is explicit. Lower display-order numbers appear first. Images use HTTPS URLs; uploads and Supabase Storage are not included.

`admins` membership can only be assigned by the project owner. Row-level security allows public reads of published content, approved admin writes, and admin reads of drafts. Every mutation also checks authentication and membership on the server. Content and ticket mutations use authenticated clients and database access rules; the server email dispatcher uses a privileged key only for its notification queue. Auth sessions use Supabase SSR cookies and a Next.js proxy to refresh sessions. Public content queries use an anonymous client.

## Build and deploy

```sh
npm run typecheck
npm run build
npm start
```

Deploy to a Next.js-compatible host such as Vercel. This is a server app, not a static HTML upload.

1. Import the GitHub repository into the host and use the standard Next.js build command.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SITE_URL`. `SITE_URL` must be the final HTTPS origin rather than localhost.
3. Apply migrations `001_content.sql` through `008_contest_scoring_rounds.sql` in order for a fresh database. Existing installations should apply only the migrations they have not run.
4. Set the Supabase Auth Site URL to the deployed origin and allow `<SITE_URL>/auth/confirm` as a redirect URL.
5. For email notifications, also set `ADMIN_NOTIFICATION_EMAIL`, `EMAIL_FROM`, `RESEND_API_KEY`, and `SUPABASE_SECRET_KEY`. Ticketing remains usable without email delivery and shows that configuration state in the admin desk.
6. Run the end-to-end launch check in `TICKET_SETUP.md` before accepting real payments.

Receipt and banner uploads are capped at 4 MB so multipart requests remain within Vercel's Function body limit. Camera scanning requires the HTTPS address supplied by the deployed host and browser camera permission.

Local secrets belong in `.env.local`, which is ignored by Git. Copy only the variable names from `.env.example` into the hosting provider and never commit server secret values.

Google Fonts require internet access; Georgia and Arial are the font fallbacks. Reference photography is served locally. WhatsApp, Facebook and event links use the destinations shown on the reference website.

References: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
