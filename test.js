process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/rr-');
process.env.ADMIN_TOKEN = 'a'.repeat(32); process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'; delete process.env.ANTHROPIC_API_KEY;
const assert = require('assert'), crypto = require('crypto');
const { server } = require('./server');
(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port; let cookie = '';
  const req = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', cookie, ...h }, body: b ? (typeof b === 'string' ? b : JSON.stringify(b)) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json() }; };
  assert.equal((await req('POST', '/api/signup', { email: 'a@b.co', password: 'short' })).s, 400);
  assert.equal((await req('POST', '/api/signup', { email: 'a@b.co', password: 'longenough1' })).s, 200);
  assert.equal((await req('GET', '/api/me')).j.freeLeft, 3);
  for (let i = 0; i < 3; i++) assert.equal((await req('POST', '/api/generate', { stars: 5, review: 'Great food!' })).s, 200);
  assert.equal((await req('POST', '/api/generate', { stars: 5, review: 'Great food!' })).s, 402);
  // admin
  assert.equal((await req('GET', '/api/admin/stats')).s, 401);
  const A = { Authorization: 'Bearer ' + 'a'.repeat(32) };
  assert.equal((await req('GET', '/api/admin/stats', null, A)).s, 200);
  // stripe webhook: bad sig rejected, good sig upgrades
  const ev = JSON.stringify({ id: 'e1', type: 'checkout.session.completed', data: { object: { client_reference_id: '1', customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal((await req('POST', '/api/stripe/webhook', ev, { 'stripe-signature': 't=1,v1=bad' })).s, 400);
  const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', 'whsec_test').update(t + '.' + ev).digest('hex');
  assert.equal((await req('POST', '/api/stripe/webhook', ev, { 'stripe-signature': `t=${t},v1=${sig}` })).s, 200);
  assert.equal((await req('GET', '/api/me')).j.plan, 'pro');
  assert.equal((await req('POST', '/api/generate', { stars: 2, review: 'Slow service' })).s, 200);
  console.log('all tests passed'); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
