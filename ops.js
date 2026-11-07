#!/usr/bin/env node
// Operator CLI: node ops.js <stats|users|events|grant <id>|revoke <id>|suspend <id>|restore <id>>
// Talks to the running server using ADMIN_TOKEN and BASE_URL from .env / environment.
const fs = require('fs'), path = require('path');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch {}
const base = process.env.BASE_URL || 'http://localhost:3000';
const call = (p, b) => fetch(base + p, { method: b ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + process.env.ADMIN_TOKEN, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
(async () => {
  const [cmd, id] = process.argv.slice(2);
  const map = { stats: () => call('/api/admin/stats'), users: () => call('/api/admin/users'), events: () => call('/api/admin/events'),
    grant: () => call('/api/admin/user', { id, plan: 'pro' }), revoke: () => call('/api/admin/user', { id, plan: 'free' }),
    suspend: () => call('/api/admin/user', { id, status: 'suspended' }), restore: () => call('/api/admin/user', { id, status: 'active' }) };
  if (!map[cmd]) return console.log('usage: node ops.js stats|users|events|grant <id>|revoke <id>|suspend <id>|restore <id>');
  console.log(JSON.stringify(await map[cmd](), null, 2));
})();
