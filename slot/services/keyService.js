const crypto = require('crypto');
const db = require('../database/db');

function generateKeyCode() {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `SLOT-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function getKeyByUser(guildId, userId) {
  return db
    .prepare('SELECT * FROM free_keys WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

function getKeyByCode(keyCode) {
  return db
    .prepare('SELECT * FROM free_keys WHERE key_code = ?')
    .get(keyCode.trim().toUpperCase());
}

function claimKey(guildId, userId) {
  const existing = getKeyByUser(guildId, userId);
  if (existing) {
    return { ok: true, created: false, key: existing };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const keyCode = generateKeyCode();
    try {
      const info = db
        .prepare(`
          INSERT INTO free_keys (guild_id, user_id, key_code, created_at, used_at)
          VALUES (?, ?, ?, ?, NULL)
        `)
        .run(guildId, userId, keyCode, Date.now());

      const key = db.prepare('SELECT * FROM free_keys WHERE id = ?').get(info.lastInsertRowid);
      return { ok: true, created: true, key };
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) continue;
      throw err;
    }
  }

  return { ok: false, error: 'KEY_GEN_FAILED' };
}

function markKeyUsed(keyId) {
  db.prepare('UPDATE free_keys SET used_at = ? WHERE id = ?').run(Date.now(), keyId);
}

module.exports = {
  generateKeyCode,
  getKeyByUser,
  getKeyByCode,
  claimKey,
  markKeyUsed,
};
