const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, process.env.DB_FILE || 'app.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  business TEXT DEFAULT '', voice TEXT DEFAULT '',
  plan TEXT DEFAULT 'free', status TEXT DEFAULT 'active',
  stripe_customer TEXT, stripe_sub TEXT,
  free_used INTEGER DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS generations(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, stars INTEGER, review TEXT, reply TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, type TEXT, data TEXT, created INTEGER NOT NULL);
`);
module.exports = db;
