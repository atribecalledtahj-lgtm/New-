# ReviewReply

Subscription micro-SaaS: local businesses paste a customer review and get an on-brand AI reply. Free tier (3 replies), Pro $29/mo (300 replies/mo). Zero npm dependencies; Node >= 22.5, SQLite via `node:sqlite`.

Target: $1,000/week ≈ **149 Pro subscribers** at $29/mo (`ops stats` shows progress). This is a target, not a forecast; revenue depends entirely on acquiring customers.

## Run
```
cp .env.example .env   # fill in values
npm test && npm start
```

## Operator access (how Claude / you run the platform)
There is no hidden access. Operator access is explicit, documented, and revocable:
1. **`ADMIN_TOKEN`** (env var, 16+ chars, you generate and own it). Gives `/admin.html`, `/api/admin/*`, and the `npm run ops` CLI. Rotate it any time by changing the env var and restarting. Unset = admin disabled.
2. **This git repo** — any Claude Code session given repo + environment access can read/modify/deploy code.
3. Share `ADMIN_TOKEN` with Claude sessions only via your environment secrets, never in chat or git.

CLI: `npm run ops -- stats | users | events | grant <id> | revoke <id> | suspend <id> | restore <id>`

## Go-live checklist (you)
1. Buy a domain; deploy to any Node host (Render/Fly/Railway/VPS) with a persistent disk at `DATA_DIR`. HTTPS required.
2. Stripe: create a $29/mo recurring Price → `STRIPE_PRICE_ID`; add `STRIPE_SECRET_KEY`; webhook endpoint `https://YOURDOMAIN/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` → `STRIPE_WEBHOOK_SECRET`. Enable the Billing Portal in Stripe settings.
3. Set `ANTHROPIC_API_KEY` (cost is roughly a fraction of a cent per reply), `BASE_URL`, `ADMIN_TOKEN`.
4. Add a privacy policy and terms before taking payments.

## Growth plan (week 1–4)
- Free-tool SEO page per niche (restaurant / dentist / salon / auto-repair / hotel review replies).
- Cold outreach: find local businesses with unanswered 1–3★ reviews, send a personalized free sample reply + link.
- Partner with local marketing agencies (10 client seats each); add an agency plan ($99 for 5 locations) next.
- Next features: Google Business Profile auto-posting, email digest of new reviews, multi-location.
