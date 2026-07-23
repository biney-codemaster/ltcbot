/**
 * Slot system settings. Uses Nestoo Discord env vars + optional OWNER_ID.
 * OWNER_ID is required for owner-only /slot subcommands (create, renew, delete, config, panels).
 */
const nestooConfig = require("../config");

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Channel where /setup (Start a deal) lives — linked from ping counters & slot guides. */
function getStartDealChannelId() {
  if (typeof nestooConfig.readChannelId === "function") {
    return nestooConfig.readChannelId(
      "START_DEAL_CHANNEL_ID",
      "DEAL_CHANNEL_ID",
      "MIDDLEMAN_CHANNEL_ID"
    );
  }
  const raw = String(process.env.START_DEAL_CHANNEL_ID || process.env.DEAL_CHANNEL_ID || "").trim();
  const m = raw.match(/(\d{16,22})/);
  return m ? m[1] : null;
}

module.exports = {
  ownerId: String(process.env.OWNER_ID || "").trim() || null,
  get startDealChannelId() {
    return getStartDealChannelId();
  },
  getStartDealChannelId,
  checkIntervalMs: optionalInt("SLOT_CHECK_INTERVAL_MS", 60_000),
  defaultEveryonePings: optionalInt("SLOT_DEFAULT_EVERYONE_PINGS", 1),
  defaultHerePings: optionalInt("SLOT_DEFAULT_HERE_PINGS", 2),
  defaultWarnHours: optionalInt("SLOT_DEFAULT_WARN_HOURS", 24),
  timezone: String(process.env.SLOT_TIMEZONE || "Europe/Paris").trim() || "Europe/Paris",
  freeSlotDays: optionalInt("SLOT_FREE_DAYS", 30),
  freeEveryonePings: optionalInt("SLOT_FREE_EVERYONE_PINGS", 1),
  freeHerePings: optionalInt("SLOT_FREE_HERE_PINGS", 1),
};
