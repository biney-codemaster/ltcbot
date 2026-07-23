const db = require('../database/db');
const config = require('../config');

function parisDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getSettings(guildId) {
  return (
    db.prepare('SELECT * FROM settings WHERE guild_id = ?').get(guildId) || {
      guild_id: guildId,
      slot_role_id: null,
      log_channel_id: null,
      category_id: null,
      default_everyone_pings: config.defaultEveryonePings,
      default_here_pings: config.defaultHerePings,
      warn_hours: config.defaultWarnHours,
      free_panel_channel_id: null,
      free_panel_message_id: null,
      buy_panel_channel_id: null,
      buy_panel_message_id: null,
    }
  );
}

function upsertSettings(guildId, patch) {
  const current = getSettings(guildId);
  const next = { ...current, ...patch, guild_id: guildId };

  db.prepare(`
    INSERT INTO settings (
      guild_id, slot_role_id, log_channel_id, category_id,
      default_everyone_pings, default_here_pings, warn_hours,
      free_panel_channel_id, free_panel_message_id,
      buy_panel_channel_id, buy_panel_message_id
    )
    VALUES (
      @guild_id, @slot_role_id, @log_channel_id, @category_id,
      @default_everyone_pings, @default_here_pings, @warn_hours,
      @free_panel_channel_id, @free_panel_message_id,
      @buy_panel_channel_id, @buy_panel_message_id
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      slot_role_id = excluded.slot_role_id,
      log_channel_id = excluded.log_channel_id,
      category_id = excluded.category_id,
      default_everyone_pings = excluded.default_everyone_pings,
      default_here_pings = excluded.default_here_pings,
      warn_hours = excluded.warn_hours,
      free_panel_channel_id = excluded.free_panel_channel_id,
      free_panel_message_id = excluded.free_panel_message_id,
      buy_panel_channel_id = excluded.buy_panel_channel_id,
      buy_panel_message_id = excluded.buy_panel_message_id
  `).run(next);

  return getSettings(guildId);
}

function setFreePanelRef(guildId, channelId, messageId) {
  upsertSettings(guildId, {
    free_panel_channel_id: channelId || null,
    free_panel_message_id: messageId || null,
  });
}

function setBuyPanelRef(guildId, channelId, messageId) {
  upsertSettings(guildId, {
    buy_panel_channel_id: channelId || null,
    buy_panel_message_id: messageId || null,
  });
}

function getSlot(guildId, userId) {
  return db
    .prepare('SELECT * FROM slots WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

function getSlotById(id) {
  return db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
}

function getSlotByChannel(guildId, channelId) {
  return db
    .prepare('SELECT * FROM slots WHERE guild_id = ? AND channel_id = ?')
    .get(guildId, channelId);
}

function listSlots(guildId) {
  return db
    .prepare('SELECT * FROM slots WHERE guild_id = ? ORDER BY expires_at ASC')
    .all(guildId);
}

function countFreeSlots(guildId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM slots WHERE guild_id = ? AND plan = 'free'`)
    .get(guildId).n;
}

function countPaidSlots(guildId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM slots WHERE guild_id = ? AND plan != 'free'`)
    .get(guildId).n;
}

function createSlot({
  guildId,
  userId,
  channelId,
  maxEveryonePings,
  maxHerePings,
  durationDays,
  plan = 'free',
}) {
  const now = Date.now();
  const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;
  const planId = String(plan || 'free').toLowerCase();

  const info = db
    .prepare(`
      INSERT INTO slots (
        guild_id, user_id, channel_id,
        max_everyone_pings, max_here_pings,
        created_at, expires_at, warned, plan
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(
      guildId,
      userId,
      channelId || null,
      maxEveryonePings,
      maxHerePings,
      now,
      expiresAt,
      planId
    );

  return getSlotById(info.lastInsertRowid);
}

function renewSlot(guildId, userId, durationDays) {
  const slot = getSlot(guildId, userId);
  if (!slot) return null;

  const base = Math.max(slot.expires_at, Date.now());
  const expiresAt = base + durationDays * 24 * 60 * 60 * 1000;

  db.prepare(`
    UPDATE slots
    SET expires_at = ?, warned = 0
    WHERE id = ?
  `).run(expiresAt, slot.id);

  return getSlotById(slot.id);
}

function deleteSlot(guildId, userId) {
  const slot = getSlot(guildId, userId);
  if (!slot) return null;

  db.prepare('DELETE FROM slots WHERE id = ?').run(slot.id);
  return slot;
}

function updateSlotChannel(slotId, channelId) {
  db.prepare('UPDATE slots SET channel_id = ? WHERE id = ?').run(channelId, slotId);
  return getSlotById(slotId);
}

function markWarned(slotId) {
  db.prepare('UPDATE slots SET warned = 1 WHERE id = ?').run(slotId);
}

function getExpiredSlots(now = Date.now()) {
  return db.prepare('SELECT * FROM slots WHERE expires_at <= ?').all(now);
}

function getSlotsNeedingWarning(now = Date.now()) {
  return db
    .prepare(`
      SELECT s.*, st.warn_hours
      FROM slots s
      LEFT JOIN settings st ON st.guild_id = s.guild_id
      WHERE s.warned = 0
    `)
    .all()
    .filter((slot) => {
      const warnHours = slot.warn_hours ?? config.defaultWarnHours;
      const warnAt = slot.expires_at - warnHours * 60 * 60 * 1000;
      return now >= warnAt && now < slot.expires_at;
    });
}

function getPingCounts(slotId) {
  const day = parisDayKey();
  const row = db
    .prepare('SELECT everyone_count, here_count FROM ping_counts WHERE slot_id = ? AND day_key = ?')
    .get(slotId, day);

  return {
    dayKey: day,
    everyone: row?.everyone_count || 0,
    here: row?.here_count || 0,
  };
}

function ensurePingRow(slotId, dayKey) {
  db.prepare(`
    INSERT INTO ping_counts (slot_id, day_key, everyone_count, here_count)
    VALUES (?, ?, 0, 0)
    ON CONFLICT(slot_id, day_key) DO NOTHING
  `).run(slotId, dayKey);
}

function incrementEveryonePing(slotId) {
  const day = parisDayKey();
  ensurePingRow(slotId, day);
  db.prepare(`
    UPDATE ping_counts
    SET everyone_count = everyone_count + 1
    WHERE slot_id = ? AND day_key = ?
  `).run(slotId, day);
  return getPingCounts(slotId);
}

function incrementHerePing(slotId) {
  const day = parisDayKey();
  ensurePingRow(slotId, day);
  db.prepare(`
    UPDATE ping_counts
    SET here_count = here_count + 1
    WHERE slot_id = ? AND day_key = ?
  `).run(slotId, day);
  return getPingCounts(slotId);
}

module.exports = {
  parisDayKey,
  getSettings,
  upsertSettings,
  setFreePanelRef,
  setBuyPanelRef,
  getSlot,
  getSlotById,
  getSlotByChannel,
  listSlots,
  countFreeSlots,
  countPaidSlots,
  createSlot,
  renewSlot,
  deleteSlot,
  updateSlotChannel,
  markWarned,
  getExpiredSlots,
  getSlotsNeedingWarning,
  getPingCounts,
  incrementEveryonePing,
  incrementHerePing,
};
