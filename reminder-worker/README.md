# reminder-worker

The backend half of LIFEMan.EXE's Web Push reminders. A Cloudflare Worker that stores each
subscriber's push subscription + reminder list in KV, and once a minute (Cron Trigger) sends a
real Web Push message for anything due. See the main repo's `docs/ROADMAP.md` ("Web Push
reminders") for the design writeup and `CLAUDE.md` ("Reminder push notifications") for how the
client side calls this.

**`src/index.js` implements the Web Push message encryption (RFC 8291) and VAPID auth (RFC 8292)
by hand with WebCrypto** — the standard `web-push` npm package can't run on Workers. It has never
been exercised against a real push service from a dev sandbox (there's no way to create a real
`PushSubscription` without an actual browser). Treat the first real end-to-end test — enabling
notifications on a real installed iOS PWA — as the actual verification of this code, not this
file existing/deploying without error.

## One-time setup

```bash
cd reminder-worker
npm install
npx wrangler login          # opens a browser tab — click Allow once
npx wrangler kv namespace create REMINDERS_KV
```

That last command prints an `id = "..."` — paste it into `wrangler.toml`'s `[[kv_namespaces]]`
block, replacing the placeholder.

Set the two secrets (never go in `wrangler.toml` or get committed):

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
# paste the private key value when prompted (see the main repo's CLAUDE.md / your password manager)

npx wrangler secret put VAPID_SUBJECT_EMAIL
# paste an email address (or "mailto:you@example.com") — VAPID requires a contact per RFC 8292;
# push services only use it if something's wrong (e.g. to know who to contact about a misbehaving
# sender), it's never emailed anyone or shown to a user
```

Deploy:

```bash
npx wrangler deploy
```

This prints your Worker's URL, something like `https://lifeman-reminders.<your-subdomain>.workers.dev`.
Paste that into `REMINDER_BACKEND_URL` in the main app's `app.js`, then redeploy the app (bump
`<meta name="app-build">` in `index.html` per the usual deploy step).

## Verifying it's alive

```bash
npx wrangler tail
```

streams live logs — useful when testing "ENABLE REMINDER NOTIFICATIONS" on a real device, to see
the `/subscribe` request land, and later to see `checkDueReminders()`'s cron tick fire and (once
a reminder is due) the push attempt and its result.

## Re-deploying after editing `src/index.js`

Just `npx wrangler deploy` again — no separate build step.

## Cost

Free tier: 100,000 requests/day, Cron Triggers included, KV free tier (100k reads/day, 1k
writes/day) — a single-user reminders app will not come close to any of these limits.
