process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/ag-');
Object.assign(process.env, { ADMIN_TOKEN: 'a'.repeat(32), BUSINESS_NAME: 'Test Studio', BUSINESS_ADDRESS: '1 Main St, Town, ST 00000' });
delete process.env.RESEND_API_KEY;
const assert = require('assert');
const { server } = require('./server');
(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port;
  const A = { Authorization: 'Bearer ' + 'a'.repeat(32) };
  const req = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j }; };
  assert.equal((await req('GET', '/api/admin/stats')).s, 401);
  assert.equal((await req('GET', '/api/admin/prospects', null, { Authorization: 'Bearer wrong' })).s, 401);
  // create prospect with a site but no observation -> draft must flag it
  const id = (await req('POST', '/api/admin/prospect', { name: 'Joe <b>Plumbing</b>', niche: 'plumbing', city: 'Town', email: 'joe@example.com', current_site: 'http://old.example.com' }, A)).j.id;
  let d = (await req('GET', '/api/admin/draft?id=' + id, null, A)).j;
  assert(d.problems.some(p => p.startsWith('observation')), 'must require a true observation');
  await req('POST', '/api/admin/update', { id, observation: 'Your site is not mobile friendly' }, A);
  d = (await req('GET', '/api/admin/draft?id=' + id, null, A)).j;
  assert.equal(d.problems.length, 0); assert(d.body.includes('1 Main St')); assert(d.body.includes('/unsubscribe?t='));
  // preview is escaped and public
  const pv = await req('GET', '/preview/joe-b-plumbing-b');
  assert.equal(pv.s, 200); assert(!pv.j.includes('<b>Plumbing</b>')); assert(pv.j.includes('noindex'));
  // sending refused without email provider
  assert.equal((await req('POST', '/api/admin/send', { id }, A)).s, 503);
  // inbound lead + honeypot
  assert.equal((await req('POST', '/api/lead', { name: 'Bot', email: 'x@y.co', website: 'spam' })).s, 200);
  assert.equal((await req('POST', '/api/lead', { name: 'Sal Salon', email: 'sal@example.com', niche: 'salon' })).s, 200);
  assert.equal((await req('GET', '/api/admin/prospects', null, A)).j.length, 2);
  // won -> revenue stats
  await req('POST', '/api/admin/update', { id, status: 'won' }, A);
  const st = (await req('GET', '/api/admin/stats', null, A)).j;
  assert.equal(st.mrr_usd, 59); assert.equal(st.setup_fees_last_7d_usd, 500);
  // unsubscribe: bad token rejected, good token removes
  assert.equal((await req('GET', '/unsubscribe?t=1.bad')).s, 400);
  const tok = d.body.match(/unsubscribe\?t=(\S+)/)[1];
  assert.equal((await req('GET', '/unsubscribe?t=' + tok)).s, 200);
  assert.equal((await req('GET', '/preview/joe-b-plumbing-b')).s, 404);
  assert.equal((await req('GET', '/')).s, 200);
  console.log('all tests passed'); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
