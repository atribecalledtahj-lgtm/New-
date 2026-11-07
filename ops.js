#!/usr/bin/env node
// Operator CLI. Talks to the running server with ADMIN_TOKEN and BASE_URL (from .env or environment).
// node ops.js stats | list [status] | add <json> | bulk <file.json> | draft <id> | send <id> | status <id> <status> | export <id>
const fs = require('fs'), path = require('path');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch {}
const base = process.env.BASE_URL || 'http://localhost:3000';
const call = (p, b, raw) => fetch(base + p, { method: b ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + process.env.ADMIN_TOKEN, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => raw ? r.text() : r.json());
(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  const map = {
    stats: () => call('/api/admin/stats'),
    list: () => call('/api/admin/prospects' + (a ? '?status=' + a : '')),
    add: () => call('/api/admin/prospect', JSON.parse(a)),
    bulk: () => call('/api/admin/prospects/bulk', { rows: JSON.parse(fs.readFileSync(a, 'utf8')) }),
    draft: () => call('/api/admin/draft?id=' + a),
    send: () => call('/api/admin/send', { id: +a }),
    status: () => call('/api/admin/update', { id: +a, status: b }),
    export: async () => { const h = await call('/api/admin/export?id=' + a, null, true); fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync(`dist/${a}.html`, h); return { wrote: `dist/${a}.html` }; }
  };
  if (!map[cmd]) return console.log('usage: node ops.js stats | list [status] | add <json> | bulk <file.json> | draft <id> | send <id> | status <id> <status> | export <id>');
  console.log(JSON.stringify(await map[cmd](), null, 2));
})();
