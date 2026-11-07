const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, process.env.DB_FILE || 'agency.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS prospects(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, niche TEXT DEFAULT 'generic', city TEXT DEFAULT '',
  email TEXT DEFAULT '', phone TEXT DEFAULT '', current_site TEXT DEFAULT '', observation TEXT DEFAULT '',
  tagline TEXT DEFAULT '', services TEXT DEFAULT '', about TEXT DEFAULT '', hours TEXT DEFAULT '', color TEXT DEFAULT '',
  slug TEXT UNIQUE, status TEXT DEFAULT 'new', source TEXT DEFAULT 'manual', notes TEXT DEFAULT '',
  monthly_usd INTEGER DEFAULT 0, setup_usd INTEGER DEFAULT 0,
  created INTEGER NOT NULL, last_contacted INTEGER);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, type TEXT, data TEXT, created INTEGER NOT NULL);
`);
module.exports = db;
