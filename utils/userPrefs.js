const db = require("../database");

function ensurePrefsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id TEXT PRIMARY KEY,
      anonymous INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function isUserAnonymous(userId) {
  if (!userId) return false;
  ensurePrefsTable();
  const row = db.prepare(`SELECT anonymous FROM user_prefs WHERE user_id = ?`).get(String(userId));
  return Boolean(row?.anonymous);
}

function setUserAnonymous(userId, anonymous) {
  ensurePrefsTable();
  db.prepare(
    `INSERT INTO user_prefs (user_id, anonymous, updated_at)
     VALUES (@user_id, @anonymous, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       anonymous = @anonymous,
       updated_at = datetime('now')`
  ).run({
    user_id: String(userId),
    anonymous: anonymous ? 1 : 0,
  });
  return Boolean(anonymous);
}

function formatAuthor(userId, { anonymous = null } = {}) {
  const anon = anonymous == null ? isUserAnonymous(userId) : Boolean(anonymous);
  if (anon) return "Anonyme";
  return `<@${userId}>`;
}

module.exports = {
  isUserAnonymous,
  setUserAnonymous,
  formatAuthor,
  ensurePrefsTable,
};
