const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'slots.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    slot_role_id TEXT,
    log_channel_id TEXT,
    category_id TEXT,
    default_everyone_pings INTEGER NOT NULL DEFAULT 1,
    default_here_pings INTEGER NOT NULL DEFAULT 2,
    warn_hours INTEGER NOT NULL DEFAULT 24
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    max_everyone_pings INTEGER NOT NULL DEFAULT 1,
    max_here_pings INTEGER NOT NULL DEFAULT 2,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    warned INTEGER NOT NULL DEFAULT 0,
    UNIQUE(guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ping_counts (
    slot_id INTEGER NOT NULL,
    day_key TEXT NOT NULL,
    everyone_count INTEGER NOT NULL DEFAULT 0,
    here_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (slot_id, day_key),
    FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS free_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key_code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    UNIQUE(guild_id, user_id)
  );
`);

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function ensureColumn(table, column, definition) {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('settings', 'category_id', 'TEXT');
ensureColumn('settings', 'default_everyone_pings', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('settings', 'default_here_pings', 'INTEGER NOT NULL DEFAULT 2');
ensureColumn('slots', 'max_everyone_pings', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('slots', 'max_here_pings', 'INTEGER NOT NULL DEFAULT 2');

module.exports = db;
