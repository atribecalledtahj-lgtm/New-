const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

// load .env (no dependency)
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const E = process.env;
const PORT = +E.PORT || 3000;
const FREE_LIMIT = 3, PRO_MONTHLY_LIMIT = 300;
const now = () => Date.now();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const log = (type, data) => db.prepare('INSERT INTO events(type,data,created) VALUES(?,?,?)').run(type, JSON.stringify(data), now());

// ---------- helpers ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(crypto.scryptSync(pw, salt, 32).toString('hex'));
  return crypto.timingSafeEqual(a, Buffer.from(h));
}
const hits = new Map();
function limited(key, max, windowMs) {
  const t = now(), arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t); hits.set(key, arr);
  return arr.length > max;
}
function readBody(req, max = 1e6) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { rej(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
const send = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
};
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m && m[1];
}
function userFrom(req) {
  const tok = cookie(req, 'sid');
  if (!tok) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(sha(tok), now());
  return s ? db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) : null;
}
function isAdmin(req) {
  if (!E.ADMIN_TOKEN || E.ADMIN_TOKEN.length < 16) return false;
  const a = Buffer.from(sha((req.headers.authorization || '').replace(/^Bearer /, '')));
  return crypto.timingSafeEqual(a, Buffer.from(sha(E.ADMIN_TOKEN)));
}
function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(tok), userId, now() + 30 * 864e5);
  const secure = (E.BASE_URL || '').startsWith('https') ? '; Secure' : '';
  return { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` };
}
const pub = u => ({ email: u.email, business: u.business, voice: u.voice, plan: u.plan, status: u.status, freeLeft: Math.max(0, FREE_LIMIT - u.free_used), usedThisMonth: monthUsage(u.id) });
function monthUsage(id) {
  const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return db.prepare('SELECT COUNT(*) c FROM generations WHERE user_id=? AND created>=?').get(id, start).c;
}

// ---------- AI ----------
async function generateReply(user, stars, review) {
  const system = `You write replies to customer reviews on behalf of a local business.
Business: ${user.business || 'a local business'}.
Brand voice: ${user.voice || 'warm, professional, concise'}.
Rules: 40-90 words. Thank the reviewer. Be specific to what they said. For negative reviews, apologize sincerely without admitting legal liability, offer to make it right offline (do not invent phone numbers or emails). Never invent facts, discounts or policies. No emojis unless the brand voice asks. Output only the reply text.`;
  if (!E.ANTHROPIC_API_KEY) {
    return stars >= 4
      ? `Thank you so much for the ${stars}-star review! We're thrilled you had a great experience and hope to see you again soon. (Demo mode: set ANTHROPIC_API_KEY for real AI replies.)`
      : `Thank you for the feedback, and we're sorry we fell short. We'd like to make this right — please reach out to us directly. (Demo mode: set ANTHROPIC_API_KEY for real AI replies.)`;
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: E.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 300, system,
      messages: [{ role: 'user', content: `Review (${stars} stars):\n"""${review}"""` }] })
  });
  if (!r.ok) throw new Error('AI provider error ' + r.status);
  const j = await r.json();
  return (j.content || []).map(c => c.text || '').join('').trim();
}

// ---------- Stripe (REST, no SDK) ----------
async function stripe(pathname, params) {
  const r = await fetch('https://api.stripe.com/v1' + pathname, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + E.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'stripe error');
  return j;
}
function verifyStripe(raw, header) {
  if (!E.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(now() / 1000 - +parts.t) > 300) return false;
  const exp = crypto.createHmac('sha256', E.STRIPE_WEBHOOK_SECRET).update(parts.t + '.' + raw).digest('hex');
  const a = Buffer.from(exp), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function applyStripeEvent(ev) {
  const o = ev.data.object;
  if (ev.type === 'checkout.completed' || ev.type === 'checkout.session.completed') {
    const uid = +o.client_reference_id;
    if (uid) db.prepare("UPDATE users SET plan='pro',stripe_customer=?,stripe_sub=? WHERE id=?").run(o.customer, o.subscription, uid);
  } else if (ev.type === 'customer.subscription.deleted' || (ev.type === 'customer.subscription.updated' && ['canceled', 'unpaid', 'past_due'].includes(o.status))) {
    db.prepare("UPDATE users SET plan='free' WHERE stripe_customer=?").run(o.customer);
  } else if (ev.type === 'customer.subscription.updated' && o.status === 'active') {
    db.prepare("UPDATE users SET plan='pro' WHERE stripe_customer=?").run(o.customer);
  }
  log('stripe:' + ev.type, { id: ev.id });
}

// ---------- routes ----------
const routes = {};
const route = (m, p, fn) => (routes[m + ' ' + p] = fn);
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const validEmail = e => typeof e === 'string' && e.length < 255 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

route('POST', '/api/signup', async (req, res, body) => {
  if (limited('auth:' + ip(req), 10, 36e5)) return send(res, 429, { error: 'Too many attempts' });
  const { email, password } = body;
  if (!validEmail(email) || typeof password !== 'string' || password.length < 8) return send(res, 400, { error: 'Valid email and 8+ char password required' });
  try {
    const r = db.prepare('INSERT INTO users(email,pass,created) VALUES(?,?,?)').run(email.toLowerCase(), hashPw(password), now());
    log('signup', { email: email.toLowerCase() });
    send(res, 200, { ok: true }, startSession(res, Number(r.lastInsertRowid)));
  } catch { send(res, 409, { error: 'Email already registered' }); }
});
route('POST', '/api/login', async (req, res, body) => {
  if (limited('auth:' + ip(req), 20, 36e5)) return send(res, 429, { error: 'Too many attempts' });
  const u = validEmail(body.email) && db.prepare('SELECT * FROM users WHERE email=?').get(body.email.toLowerCase());
  if (!u || typeof body.password !== 'string' || !checkPw(body.password, u.pass) || u.status !== 'active') return send(res, 401, { error: 'Invalid credentials' });
  send(res, 200, { ok: true }, startSession(res, u.id));
});
route('POST', '/api/logout', async (req, res) => {
  const t = cookie(req, 'sid'); if (t) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(t));
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/' });
});
route('GET', '/api/me', async (req, res) => {
  const u = userFrom(req); if (!u) return send(res, 401, { error: 'Not signed in' });
  send(res, 200, pub(u));
});
route('POST', '/api/profile', async (req, res, body) => {
  const u = userFrom(req); if (!u) return send(res, 401, { error: 'Not signed in' });
  db.prepare('UPDATE users SET business=?,voice=? WHERE id=?').run(String(body.business || '').slice(0, 120), String(body.voice || '').slice(0, 400), u.id);
  send(res, 200, { ok: true });
});
route('POST', '/api/generate', async (req, res, body) => {
  const u = userFrom(req); if (!u) return send(res, 401, { error: 'Not signed in' });
  const stars = Math.min(5, Math.max(1, parseInt(body.stars) || 5));
  const review = String(body.review || '').trim().slice(0, 2000);
  if (review.length < 3) return send(res, 400, { error: 'Paste a review first' });
  if (limited('gen:' + u.id, 20, 6e4)) return send(res, 429, { error: 'Slow down a little' });
  if (u.plan === 'pro') { if (monthUsage(u.id) >= PRO_MONTHLY_LIMIT) return send(res, 402, { error: 'Monthly fair-use limit reached' }); }
  else if (u.free_used >= FREE_LIMIT) return send(res, 402, { error: 'Free replies used up. Upgrade to continue.', upgrade: true });
  let reply;
  try { reply = await generateReply(u, stars, review); } catch (e) { log('ai_error', { msg: e.message }); return send(res, 502, { error: 'Could not generate a reply, try again' }); }
  db.prepare('INSERT INTO generations(user_id,stars,review,reply,created) VALUES(?,?,?,?,?)').run(u.id, stars, review, reply, now());
  if (u.plan !== 'pro') db.prepare('UPDATE users SET free_used=free_used+1 WHERE id=?').run(u.id);
  send(res, 200, { reply, ...pub(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
});
route('POST', '/api/checkout', async (req, res) => {
  const u = userFrom(req); if (!u) return send(res, 401, { error: 'Not signed in' });
  if (!E.STRIPE_SECRET_KEY || !E.STRIPE_PRICE_ID) return send(res, 503, { error: 'Billing not configured yet' });
  try {
    const s = await stripe('/checkout/sessions', {
      mode: 'subscription', 'line_items[0][price]': E.STRIPE_PRICE_ID, 'line_items[0][quantity]': '1',
      client_reference_id: String(u.id),
      ...(u.stripe_customer ? { customer: u.stripe_customer } : { customer_email: u.email }),
      success_url: E.BASE_URL + '/app.html?paid=1', cancel_url: E.BASE_URL + '/app.html'
    });
    send(res, 200, { url: s.url });
  } catch (e) { send(res, 502, { error: e.message }); }
});
route('POST', '/api/portal', async (req, res) => {
  const u = userFrom(req); if (!u || !u.stripe_customer) return send(res, 400, { error: 'No subscription' });
  try { const s = await stripe('/billing_portal/sessions', { customer: u.stripe_customer, return_url: E.BASE_URL + '/app.html' }); send(res, 200, { url: s.url }); }
  catch (e) { send(res, 502, { error: e.message }); }
});
route('POST', '/api/stripe/webhook', async (req, res, _b, raw) => {
  if (!verifyStripe(raw.toString(), req.headers['stripe-signature'])) return send(res, 400, { error: 'bad signature' });
  applyStripeEvent(JSON.parse(raw)); send(res, 200, { received: true });
});

// ---------- admin (operator access via ADMIN_TOKEN) ----------
route('GET', '/api/admin/stats', async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
  const c = q => db.prepare(q).get().c;
  const pro = c("SELECT COUNT(*) c FROM users WHERE plan='pro'");
  send(res, 200, {
    users: c('SELECT COUNT(*) c FROM users'), pro, mrr_usd: pro * 29, weekly_run_rate_usd: +(pro * 29 * 12 / 52).toFixed(2),
    signups_7d: c(`SELECT COUNT(*) c FROM users WHERE created>${now() - 7 * 864e5}`),
    generations_7d: c(`SELECT COUNT(*) c FROM generations WHERE created>${now() - 7 * 864e5}`),
    target_weekly_usd: 1000, pro_needed_for_target: Math.ceil(1000 * 52 / 12 / 29)
  });
});
route('GET', '/api/admin/users', async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, db.prepare('SELECT id,email,business,plan,status,free_used,created FROM users ORDER BY id DESC LIMIT 500').all());
});
route('POST', '/api/admin/user', async (req, res, b) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
  const id = +b.id; if (!id) return send(res, 400, { error: 'id required' });
  if (b.plan) db.prepare('UPDATE users SET plan=? WHERE id=?').run(b.plan === 'pro' ? 'pro' : 'free', id);
  if (b.status) db.prepare('UPDATE users SET status=? WHERE id=?').run(b.status === 'suspended' ? 'suspended' : 'active', id);
  if (b.status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  log('admin_user_update', b); send(res, 200, { ok: true });
});
route('GET', '/api/admin/events', async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
  send(res, 200, db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 200').all());
});
route('GET', '/healthz', async (req, res) => send(res, 200, { ok: true }));

// ---------- static + server ----------
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const sec = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
const server = http.createServer(async (req, res) => {
  try {
    for (const [k, v] of Object.entries(sec)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x');
    const fn = routes[req.method + ' ' + url.pathname];
    if (fn) {
      const raw = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
      let body = {}; if (raw.length && url.pathname !== '/api/stripe/webhook') { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); } }
      return await fn(req, res, body, raw);
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'not found' });
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(__dirname, 'public', path.normalize(p));
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); }
});
if (require.main === module) server.listen(PORT, () => console.log('ReviewReply on :' + PORT + (E.ANTHROPIC_API_KEY ? '' : ' [demo AI]') + ((E.ADMIN_TOKEN || '').length >= 16 ? '' : ' [ADMIN_TOKEN missing/short: admin disabled]')));
module.exports = { server, applyStripeEvent, verifyStripe };
