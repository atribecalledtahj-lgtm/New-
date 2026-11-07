# Local-business web agency platform

Business: build websites for local businesses that have no site or an outdated one, for a flat **$500**, plus an optional **$59/month** plan (hosting, SSL, security updates, backups, small edits). Later upsells: ads management, UGC creators, custom apps.

Zero npm dependencies. Node >= 22.5, SQLite via `node:sqlite`.

## What's in the box
- `gen.js` – site generator (niche presets: plumbing, hvac, salon, barber, restaurant, dental, generic). Outputs mobile-first HTML with LocalBusiness schema for search and AI discovery.
- Prospect tracker + operator console at `/admin.html`; the same functions are available via `npm run ops`.
- Free sample page per prospect at `/preview/<slug>` (noindex, removed on unsubscribe).
- Outreach drafts (`outreach.js`) with required legal footer (business name, postal address, one-click unsubscribe). If a prospect has a site, a **true, specific observation** is required before a draft is valid. Nothing is fabricated.
- Public landing page + inbound lead form (`/`).

## Run
```
cp .env.example .env   # fill in values
npm test && npm start
```

## Operator access
No hidden access. Operator access is explicit and revocable:
1. `ADMIN_TOKEN` (env var, 16+ chars, owned by you). It unlocks `/admin.html`, `/api/admin/*` and the CLI. Rotate by changing it and restarting. Unset = admin disabled.
2. This git repo, for any Claude Code session you grant access to.
Share the token with Claude sessions only through environment secrets, never in chat or git.

CLI: `npm run ops -- stats | list [status] | add '<json>' | bulk file.json | draft <id> | send <id> | status <id> <status> | export <id>`

## Weekly operating loop
1. Find ~50 local businesses in one city with no site or a visibly outdated one (Google Maps/Yelp). Record name, email (from their public listing), and what you actually observed.
2. `bulk` import them; review each `/preview/<slug>` sample.
3. `draft` then `send` (needs Resend + a verified sending domain). Send at most ~30–50/day from a fresh domain.
4. When someone replies, close with a Stripe Payment Link; set status `won` (records $500 + $59/mo).
5. `export <id>` the final site, deploy to free static hosting (Cloudflare Pages/Netlify) on the client's domain.

## Go-live checklist (owner)
1. Domain + deploy this app to a Node host with a persistent disk (`DATA_DIR`), HTTPS on.
2. Stripe: create Payment Links for the $500 setup and the $59/mo plan → `PAY_LINK_*`.
3. Resend (or any provider) with a verified domain → `RESEND_API_KEY`, `EMAIL_FROM`.
4. Set `BUSINESS_NAME`, `BUSINESS_ADDRESS` (a real postal address is legally required in commercial email), `ADMIN_TOKEN`.
5. Service agreement: clients own their domain/content; maintenance is month-to-month. Get a lawyer's review.

## Math
$1,000/week ≈ 2 new $500 sites/week, or recurring revenue of ~$4,330/mo (≈74 clients at $59). A target, not a forecast; results depend on outreach volume and reply rates.
