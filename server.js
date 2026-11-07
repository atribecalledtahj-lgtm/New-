const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { renderSite, slugify, PRESETS } = require('./gen');
const outreach = require('./outreach');

// load .env (no dependency)
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const E = process.env;
E.BASE_URL = (E.BASE_URL || 'http://localhost:' + (E.PORT || 3000)).replace(/\/$/, '');
const PORT = +E.PORT || 3000;
const SETUP = +E.SETUP_PRICE || 500, MAINT = +E.MAINT_PRICE || 59;
const now = () => Date.now();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const log = (type, data) => db.prepare('INSERT INTO events(type,data,created) VALUES(?,?,?)').run(type, JSON.stringify(data), now());
const STATUSES = ['new', 'sampled', 'contacted', 'replied', 'won', 'lost', 'unsubscribed'];

// ---------- helpers ----------
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
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
const html = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(body); };
function isAdmin(req) {
  if (!E.ADMIN_TOKEN || E.ADMIN_TOKEN.length < 16) return false;
  const a = Buffer.from(sha((req.headers.authorization || '').replace(/^Bearer /, '')));
  return crypto.timingSafeEqual(a, Buffer.from(sha(E.ADMIN_TOKEN)));
}
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const validEmail = e => typeof e === 'string' && e.length < 255 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const str = (v, n) => String(v ?? '').trim().slice(0, n);
function uniqueSlug(name) {
  const base = slugify(name); let s = base, i = 1;
  while (db.prepare('SELECT 1 FROM prospects WHERE slug=?').get(s)) s = base + '-' + ++i;
  return s;
}
const FIELDS = ['name', 'niche', 'city', 'email', 'phone', 'current_site', 'observation', 'tagline', 'services', 'about', 'hours', 'color', 'notes'];
const LIMITS = { services: 600, about: 1200, notes: 2000, observation: 400, tagline: 120 };

function createProspect(b, source) {
  const name = str(b.name, 120); if (!name) throw new Error('name required');
  const niche = PRESETS[b.niche] ? b.niche : 'generic';
  const vals = { niche };
  for (const f of FIELDS) if (f !== 'niche') vals[f] = str(b[f], LIMITS[f] || 200);
  vals.name = name;
  const r = db.prepare(`INSERT INTO prospects(name,niche,city,email,phone,current_site,observation,tagline,services,about,hours,color,notes,slug,source,status,created)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(vals.name, niche, vals.city, vals.email.toLowerCase(), vals.phone, vals.current_site, vals.observation, vals.tagline,
    vals.services, vals.about, vals.hours, vals.color, vals.notes, uniqueSlug(name), source, source === 'inbound' ? 'replied' : 'new', now());
  log('prospect_created', { id: Number(r.lastInsertRowid), source });
  return Number(r.lastInsertRowid);
}

// ---------- email (optional; needs RESEND_API_KEY + EMAIL_FROM) ----------
async function sendEmail(to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + E.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: E.EMAIL_FROM, to: [to], subject, text, reply_to: E.REPLY_TO || undefined })
  });
  if (!r.ok) throw new Error('email provider error ' + r.status);
}

// ---------- routes ----------
const routes = {};
const route = (m, p, fn) => (routes[m + ' ' + p] = fn);
const admin = fn => async (req, res, b, raw, url) => (isAdmin(req) ? fn(req, res, b, raw, url) : send(res, 401, { error: 'unauthorized' }));

// Public: inbound lead (from the landing page form)
route('POST', '/api/lead', async (req, res, b) => {
  if (limited('lead:' + ip(req), 5, 36e5)) return send(res, 429, { error: 'Too many requests' });
  if (!validEmail(b.email)) return send(res, 400, { error: 'A valid email is required' });
  if (b.website) return send(res, 200, { ok: true }); // honeypot
  try { createProspect({ ...b, notes: 'Inbound: ' + str(b.message, 1000) }, 'inbound'); send(res, 200, { ok: true }); }
  catch (e) { send(res, 400, { error: e.message }); }
});
route('GET', '/api/public', async (req, res) => send(res, 200, { business: E.BUSINESS_NAME || 'Web Studio', setup: SETUP, maint: MAINT, payLinkSetup: E.PAY_LINK_SETUP || '', payLinkMaint: E.PAY_LINK_MAINT || '' }));
route('GET', '/healthz', async (req, res) => send(res, 200, { ok: true }));

// Admin
route('GET', '/api/admin/stats', admin(async (req, res) => {
  const c = (q, ...a) => db.prepare(q).get(...a).c;
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM prospects GROUP BY status').all().map(r => [r.status, r.c]));
  const mrr = db.prepare("SELECT COALESCE(SUM(monthly_usd),0) s FROM prospects WHERE status='won'").get().s;
  const wk = now() - 7 * 864e5;
  const setupWk = db.prepare("SELECT COALESCE(SUM(setup_usd),0) s FROM prospects WHERE status='won' AND last_contacted>?").get(wk).s;
  send(res, 200, { prospects: c('SELECT COUNT(*) c FROM prospects'), byStatus, clients: byStatus.won || 0, mrr_usd: mrr, recurring_weekly_usd: +(mrr * 12 / 52).toFixed(2), setup_fees_last_7d_usd: setupWk,
    target_weekly_usd: 1000 });
}));
route('GET', '/api/admin/prospects', admin(async (req, res, b, raw, url) => {
  const st = url.searchParams.get('status');
  send(res, 200, st ? db.prepare('SELECT * FROM prospects WHERE status=? ORDER BY id DESC LIMIT 1000').all(st) : db.prepare('SELECT * FROM prospects ORDER BY id DESC LIMIT 1000').all());
}));
route('POST', '/api/admin/prospect', admin(async (req, res, b) => {
  try { send(res, 200, { id: createProspect(b, 'manual') }); } catch (e) { send(res, 400, { error: e.message }); }
}));
route('POST', '/api/admin/prospects/bulk', admin(async (req, res, b) => {
  if (!Array.isArray(b.rows) || b.rows.length > 500) return send(res, 400, { error: 'rows[] (max 500) required' });
  let ok = 0; const errors = [];
  for (const r of b.rows) { try { createProspect(r, 'manual'); ok++; } catch (e) { errors.push(e.message); } }
  send(res, 200, { created: ok, errors: errors.slice(0, 10) });
}));
route('POST', '/api/admin/update', admin(async (req, res, b) => {
  const id = +b.id; const p = db.prepare('SELECT * FROM prospects WHERE id=?').get(id);
  if (!p) return send(res, 404, { error: 'not found' });
  const sets = [], vals = [];
  for (const f of FIELDS) if (f in b) { sets.push(f + '=?'); vals.push(f === 'niche' ? (PRESETS[b.niche] ? b.niche : 'generic') : str(b[f], LIMITS[f] || 200)); }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'bad status' });
    sets.push('status=?'); vals.push(b.status);
    if (b.status === 'won') { sets.push('setup_usd=?', 'monthly_usd=?', 'last_contacted=?'); vals.push(+b.setup_usd >= 0 && 'setup_usd' in b ? +b.setup_usd : SETUP, +b.monthly_usd >= 0 && 'monthly_usd' in b ? +b.monthly_usd : MAINT, now()); }
  }
  if (!sets.length) return send(res, 400, { error: 'nothing to update' });
  db.prepare(`UPDATE prospects SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
  log('prospect_updated', { id, keys: Object.keys(b) }); send(res, 200, { ok: true });
}));
route('GET', '/api/admin/draft', admin(async (req, res, b, raw, url) => {
  const p = db.prepare('SELECT * FROM prospects WHERE id=?').get(+url.searchParams.get('id'));
  if (!p) return send(res, 404, { error: 'not found' });
  send(res, 200, outreach.build(p, E));
}));
route('POST', '/api/admin/send', admin(async (req, res, b) => {
  const p = db.prepare('SELECT * FROM prospects WHERE id=?').get(+b.id);
  if (!p) return send(res, 404, { error: 'not found' });
  if (['unsubscribed', 'won', 'lost'].includes(p.status) || p.last_contacted && p.status === 'contacted') return send(res, 409, { error: 'Not sendable in status: ' + p.status });
  if (!E.RESEND_API_KEY || !E.EMAIL_FROM) return send(res, 503, { error: 'Email sending not configured (RESEND_API_KEY, EMAIL_FROM)' });
  const d = outreach.build(p, E);
  if (d.problems.length) return send(res, 400, { error: 'Missing: ' + d.problems.join(', ') });
  try { await sendEmail(d.to, d.subject, d.body); } catch (e) { return send(res, 502, { error: e.message }); }
  db.prepare("UPDATE prospects SET status='contacted', last_contacted=? WHERE id=?").run(now(), p.id);
  log('email_sent', { id: p.id }); send(res, 200, { ok: true });
}));
route('GET', '/api/admin/events', admin(async (req, res) => send(res, 200, db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 200').all())));
route('GET', '/api/admin/export', admin(async (req, res, b, raw, url) => {
  const p = db.prepare('SELECT * FROM prospects WHERE id=?').get(+url.searchParams.get('id'));
  if (!p) return send(res, 404, { error: 'not found' });
  html(res, 200, renderSite(p), { 'Content-Disposition': `attachment; filename="${p.slug}.html"` });
}));

// Public: sample preview + unsubscribe
route('GET', '/preview', async (req, res, b, raw, url) => {
  const slug = url.searchParams.get('s'); const p = slug && db.prepare('SELECT * FROM prospects WHERE slug=?').get(slug);
  if (!p || p.status === 'unsubscribed') return html(res, 404, 'Not found');
  html(res, 200, renderSite(p).replace('<head>', '<head><meta name="robots" content="noindex">'));
});
route('GET', '/unsubscribe', async (req, res, b, raw, url) => {
  const id = outreach.verifyUnsub(url.searchParams.get('t'), E.ADMIN_TOKEN || '');
  if (id) { db.prepare("UPDATE prospects SET status='unsubscribed', email='' WHERE id=?").run(id); log('unsubscribed', { id }); }
  html(res, id ? 200 : 400, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;max-width:480px;margin:15vh auto;padding:0 16px"><h2>${id ? "You've been unsubscribed" : 'Invalid link'}</h2><p>${id ? "We won't contact you again and your sample page has been removed." : 'This unsubscribe link is invalid. Reply to the email and we will remove you.'}</p></body>`);
});

// ---------- static + server ----------
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const sec = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
const server = http.createServer(async (req, res) => {
  try {
    for (const [k, v] of Object.entries(sec)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x');
    let pathname = url.pathname;
    const pm = pathname.match(/^\/preview\/([a-z0-9-]+)$/);
    if (pm) { pathname = '/preview'; url.searchParams.set('s', pm[1]); }
    const fn = routes[req.method + ' ' + pathname];
    if (fn) {
      const raw = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
      let body = {};
      if (raw.length) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); } }
      return await fn(req, res, body, raw, url);
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'not found' });
    const p = pathname === '/' ? '/index.html' : pathname;
    const root = path.join(__dirname, 'public');
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    if (ext === '.html') {
      const page = fs.readFileSync(file, 'utf8').replace(/\{\{BUSINESS_NAME\}\}/g, require('./gen').esc(E.BUSINESS_NAME || 'Web Studio')).replace(/\{\{SETUP\}\}/g, SETUP).replace(/\{\{MAINT\}\}/g, MAINT);
      return html(res, 200, page);
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); }
});
if (require.main === module) server.listen(PORT, () => console.log('Agency platform on :' + PORT + ((E.ADMIN_TOKEN || '').length >= 16 ? '' : ' [ADMIN_TOKEN missing/short: admin disabled]')));
module.exports = { server };
