# 🧰 Lendshed

**Lendshed** is an invite-only web app where one neighbourhood lends tools and household gear to each other for free, built with Next.js, Prisma and PostgreSQL.
Members list what they own, other members request it for specific dates, and the owner approves, hands it over and marks it returned. An organizer runs the installation and invites every member. There is no public sign-up, no payments and no notifications: neighbours arrange pickup through the contact details the app shows only to the two people on a loan.

The rule that shapes everything: **an item can never be promised to two people for the same day, even when two approvals happen at the same moment.** The database enforces it with a PostgreSQL exclusion constraint, not just the server action. The app is small by design and runs permanently on free tiers (Neon free, Vercel Hobby, Vercel Blob).

---

## 🌐 Live Demo

**[next-lendshed.vercel.app](https://next-lendshed.vercel.app/)**

Every demo account uses the password **`elm-street-demo`**.

| Role | Email | Notes |
|---|---|---|
| 🛡️ Organizer | `ruth@elm-street.test` | |
| 🛡️ Organizer | `marko@elm-street.test` | |
| 👤 Member | `ana@elm-street.test` | |
| 👤 Member | `tom@elm-street.test` | |
| 👤 Member | `lena@elm-street.test` | |
| 👤 Member | `dev@elm-street.test` | |
| 👤 Member | `ivo@elm-street.test` | No contact details saved, so he can't request loans |
| 👤 Member | `sara@elm-street.test` | |
| 🚫 Member | `nick@elm-street.test` | Suspended: signing in shows the suspended message |

Sign in as an organizer and as a member to see how access changes. The demo is shared, so other visitors may have changed its data, and it may be reset at any time. Item photos are plain colour placeholders.

---

## ✨ Features

### 👀 Guest
- 🔐 Sign in. Sign-in responses are identical for an unknown email and a wrong password, and a suspended account is told so only after a correct password
- 🔗 Open an invitation link to join, or a reset link to set a new password
- 📜 House rules and Privacy pages
- 🙈 Sees **no** item, member or loan data

### 👤 Member
- ✉️ Join only through a single-use invitation link (7 days, revocable)
- 🔎 Browse neighbours' items with search, category chips and paging, with a **Free today** label
- 🧾 Item pages with condition, max loan length, pickup notes and the dates already booked, in words
- 🧰 List up to 30 items: details first, then one photo (resized in the browser, re-encoded to WebP on the server), then List or Hide. Retire or delete an item when you're done with it
- 📅 Request a loan for specific dates (starting today to 60 days ahead, up to the item's max length), with an optional message
- ✅ As an owner: approve or decline requests, hand the item over, mark it as back
- 🔄 As a borrower: cancel a request or an approved loan
- 📋 My loans, split into Borrowing and Lending, grouped as Needs you, Active and Past, with change dots and a needs-action count in the header
- 📞 Contact details shown only to the owner and borrower of an approved or out loan, and for 7 days after its return
- 🏠 Public member profiles with their listed items
- ⚙️ Account: profile, contact details, change password, sign out, delete account

### 🛡️ Organizer
- ✅ Everything a member can do, plus:
- ✉️ Invitations: create a one-time link with an optional note, copy it, revoke open ones
- 👥 Members: search, view details, suspend and reinstate, promote and demote, create a one-time password reset link, delete a suspended member
- 🔒 Close any loan that is out, and retire any item with a required note
- 🗂️ Categories: add, rename, delete unused ones
- 📊 Usage panel: uploads this month, stored MB and listed items against the free-tier limits, with warnings at 80%
- 🛑 Safeguards: the last active organizer can't be demoted, suspended or deleted, and organizers never act on themselves

### ⚙️ Platform
- 🚫 **No double booking**: a database exclusion constraint guarantees that two approved or out loans on one item never overlap. A test runs two approvals at once and proves exactly one wins
- 🕰️ Loan dates are community dates in `Europe/Belgrade`. Expired requests, lapsed approvals and overdue loans are derived from today's date on every read, so no screen depends on a background job
- 🔁 Every loan transition re-checks the current status inside its transaction. A stale screen gets a clear message asking for a reload, never a second change
- 🧑‍🤝‍🧑 Joining is atomic: one invitation link, two simultaneous joins, exactly one account
- 🗝️ Database sessions (30 days, no cookie cache), revoked on sign-out, password change, reset and suspension. Sign-in is rate limited in the database
- 🧹 Suspending a member hides their items and cancels their open requests and pending loans; deleting an account keeps loan history as "Former member"
- 💸 Free-tier guards: at most 1,500 uploads a month, 20 per member a day and 800 MB stored. At a cap uploads pause with a friendly message and browsing keeps working
- ⏰ One daily Vercel Cron job tidies stored statuses, retries photo deletions and purges expired invitations, reset links, sessions and rate-limit rows. It is idempotent and catches up missed days
- 🔕 Private by design: every page is `noindex`, every response carries `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows everything
- ♿ WCAG 2.2 AA: 44 px targets, 48 px buttons, works at 360 px wide, visible focus, reduced motion respected

---

## 🛠️ Tech Stack
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, Cache Components) + [React 19](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (strict mode)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) (token-only theme, no component or icon library)
- **Database**: [PostgreSQL](https://www.postgresql.org/) on [Neon](https://neon.tech/) (free plan, `btree_gist` extension)
- **ORM**: [Prisma 7](https://www.prisma.io/) with the `pg` driver adapter
- **Auth**: [Better Auth](https://www.better-auth.com/) (email + password, invite-only, database sessions)
- **Validation**: [Zod 4](https://zod.dev/)
- **File Storage**: [Vercel Blob](https://vercel.com/docs/vercel-blob) behind a storage interface, with a local-disk driver for development
- **Image Handling**: [sharp](https://sharp.pixelplumbing.com/) (WebP re-encode, metadata strip) + browser canvas resize
- **Testing**: [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), [Playwright](https://playwright.dev/) for the main journeys
- **Hosting**: [Vercel](https://vercel.com/) (Hobby, Node 24, one daily Cron)

---

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/bojan-ski/next--lendshed.git
cd next--lendshed
```

### 2. Install Dependencies
Node 24 is required.
```bash
npm install
```

### 3. Create the Databases
Create a free [Neon](https://neon.tech/) project for development and tests, and a separate one for production. Each gives you two connection strings: the **pooled** URL (host contains `-pooler`) for the app, and the **direct** URL for migrations, scripts and backups. The `btree_gist` extension is created by the migrations.

### 4. Environment Setup - .env
```bash
cp .env.example .env
```

```env
# Neon: pooled for the app, direct for the Prisma CLI, scripts and backups
DATABASE_URL=
DATABASE_URL_UNPOOLED=
APP_URL=http://localhost:3000

# At least 32 characters: openssl rand -base64 32
AUTH_SECRET=

# Photo storage: "disk" (public/uploads, dev/test only) or "blob".
# With blob, both Blob values are required.
STORAGE_DRIVER=disk
BLOB_READ_WRITE_TOKEN=
BLOB_PUBLIC_HOST=

# Daily job bearer (at least 32 characters), required on Vercel
CRON_SECRET=

NEXT_PUBLIC_APP_NAME="Lendshed"
COMMUNITY_NAME="Elm Street"

# Dev/test only: must equal the host of DATABASE_URL_UNPOOLED
# for `npm run db:seed` to run. Never set it for production.
DEMO_SEED_DB_HOST=
```

The tests and the Playwright journeys read **`.env.test`** instead, so create it too, pointing at the dev/test database with `DEMO_SEED_DB_HOST` set.

### 5. Run Migrations & Seed Database
```bash
npx prisma migrate deploy
npm run db:seed
```
The demo seed loads the Elm Street cast above (password `elm-street-demo`), categories, items with placeholder photos, open invitations, and loans in every state. It refuses to run unless `DEMO_SEED_DB_HOST` names the target database host, so it can never touch production, and it is safe to run again.

**Without the demo data**, add the production categories and create the first organizer instead. Put `DATABASE_URL_UNPOOLED` and the organizer's details in a separate local file (never in Vercel):
```env
DATABASE_URL_UNPOOLED=
ORGANIZER_NAME="Ruth K."
ORGANIZER_EMAIL=
ORGANIZER_PASSWORD=
```
```bash
npx tsx --env-file=<that file> scripts/seed-categories.ts
npx tsx --env-file=<that file> scripts/bootstrap-organizer.ts
```
Sign in as that organizer and create invitation links for everyone else.

### 6. Start the Server
```bash
npm run dev
```
App: http://localhost:3000

---

## 🧪 Testing
```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
All four must pass before anything merges. While working, `npm run test:ui` runs only the component tests (no database, about 20 seconds) and `npm run test:server` runs the actions, data layer and concurrency tests against the `.env.test` database.

The Playwright tests (the lending journey join → list → request → approve → hand over → return, plus indexing, interactive-state and responsive checks) start their own `next dev` on port 3100 against `.env.test`'s database:
```bash
npx playwright install chromium
DOTENV_CONFIG_PATH=.env.test npx prisma migrate deploy
DOTENV_CONFIG_PATH=.env.test npm run db:seed
npm run e2e
```
Stop your own `npm run dev` first: only one `next dev` can run in the project folder at a time.

---

## 🌐 Deployment
- Deploy to **Vercel Hobby** (non-commercial use). `vercel.json` pins the region to Frankfurt (`fra1`) and schedules the daily job at 02:00 UTC
- Set the environment variables from `.env.example` in Vercel, with `STORAGE_DRIVER=blob`, both Blob values, a production `AUTH_SECRET` and `CRON_SECRET`, and `APP_URL` set to the production address. Never set `DEMO_SEED_DB_HOST` or the `ORGANIZER_*` values there
- Run migrations by hand from your machine over the direct URL (`npx prisma migrate deploy`), never in the Vercel build. Preview deployments never get production database credentials
- Run the production categories script and the organizer bootstrap once against the production database (see step 5)
- Changing `COMMUNITY_NAME` or the time zone is a redeploy: the app keeps no settings in the database
- Take a monthly `pg_dump` backup over the direct URL (needs the PostgreSQL client tools)

---

## 👨‍💻 Author
Developed with ❤️ by BPdevelopment (bojan-ski)
