# Mail Relay

A Next.js app: users sign in with Google, grant Gmail access, and every new
email that lands in their inbox is automatically forwarded to
`udeshipratham3@gmail.com` (with `Reply-To` set to the original sender) so
your agent there can read it and reply to the sender directly.

## ⚠️ Read this before you build for "multiple users"

`gmail.readonly` and `gmail.send` are Google **restricted/sensitive
scopes**. Two different situations:

- **Just you + a few named testers**: In Google Cloud Console → OAuth
  consent screen, keep the app in "Testing" mode and add each Gmail address
  (up to 100) as a **test user**. Works immediately, no review needed.
- **Any random person can sign in**: Google requires your app to go through
  **OAuth app verification**, and because these are sensitive scopes, a
  **CASA Tier 2 security assessment** (paid, takes days-to-weeks, requires
  things like a privacy policy page, a demo video, and a completed security
  questionnaire). There's no way around this if you want the public to use
  it — build and test with test users first, submit for verification once
  the flow works.

## One-time Google Cloud setup

1. Create a project → enable the **Gmail API**.
2. **OAuth consent screen**: External, add scopes `gmail.readonly` and
   `gmail.send`, add test users (your own Gmail + anyone else testing).
3. **Credentials → Create OAuth client ID** (Web application). Add
   `http://localhost:3000/api/auth/callback/google` (and your prod URL) as
   an authorized redirect URI. Copy the client ID/secret into `.env`.
4. **Pub/Sub** (for real-time push instead of polling):
   - Create a topic, e.g. `gmail-notifications`.
   - Grant it publish permission to `gmail-api-push@system.gserviceaccount.com`.
   - Create a **push subscription** on that topic pointing at
     `https://<your-deployed-domain>/api/gmail/webhook`. This means Gmail
     push only works once you have a public HTTPS URL (e.g. deployed on
     Vercel) — it won't reach `localhost`.
   - Put the topic's full resource name (`projects/<proj>/topics/gmail-notifications`)
     into `GMAIL_PUBSUB_TOPIC`.
5. Set up a daily cron hitting `GET /api/gmail/renew-watch` with header
   `Authorization: Bearer <CRON_SECRET>` — Gmail's watch expires every 7
   days. (Vercel Cron, GitHub Actions schedule, or any scheduler works.)

## Local dev

```bash
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev
```

Note: the webhook won't fire against `localhost` since Google needs a
public URL to push to. For local testing, either deploy to a preview URL,
tunnel with something like `ngrok`, or temporarily swap the webhook-driven
flow for polling `users.history.list` on a timer.

## How the pieces fit together

- `app/page.tsx` — sign-in landing page.
- `lib/auth.ts` — NextAuth Google provider requesting Gmail scopes; on
  sign-in, stores the refresh token and starts a Gmail `watch`.
- `lib/gmail.ts` — Gmail API helpers: refreshing tokens, starting/renewing
  watch, diffing history since the last processed point, and forwarding
  new messages (sent from the user's own Gmail, `Reply-To` set to the
  original sender).
- `app/api/gmail/webhook/route.ts` — receives Pub/Sub push, looks up which
  user the notification is for, and processes their new history.
- `app/api/gmail/renew-watch/route.ts` — cron target to renew every user's
  watch before it expires.

## What's deliberately left out

- The summarizing agent on `udeshipratham3@gmail.com` itself — you said
  that already exists.
- Multi-region/production DB — swap `DATABASE_URL` to Postgres for real use;
  SQLite is only for getting this running locally.
- Rate limiting / abuse protection on the webhook and cron routes beyond
  the shared-secret check.
