const { ActivityType } = require("discord.js");
const db = require("../database");

/** Statuses that mean a deal is still in progress (not finished / cancelled). */
const ACTIVE_STATUSES = [
  "pending_confirmation",
  "awaiting_payment",
  "funds_held",
  "disputed",
  "released",
  "refunding",
  "awaiting_review",
  "payment_failed",
];

const ROTATE_MS = 15_000;

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
let step = 0;

function countActiveDeals() {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM deals WHERE status IN (${placeholders})`)
    .get(...ACTIVE_STATUSES);
  return Number(row?.n) || 0;
}

function countCompletedDeals() {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM deals WHERE status = 'completed'`).get();
  return Number(row?.n) || 0;
}

function buildActivities() {
  const active = countActiveDeals();
  const completed = countCompletedDeals();

  // Discord shows: Watching <name>
  return [
    { name: ".gg/nestoo", type: ActivityType.Watching },
    {
      name: `${active} active deal${active === 1 ? "" : "s"}`,
      type: ActivityType.Watching,
    },
    {
      name: `${completed} completed deal${completed === 1 ? "" : "s"}`,
      type: ActivityType.Watching,
    },
    { name: "LTC · BTC · ETH · SOL", type: ActivityType.Watching },
    { name: "0% service fees", type: ActivityType.Watching },
  ];
}

function applyPresence(client) {
  if (!client?.user) return;
  const activities = buildActivities();
  const activity = activities[step % activities.length];
  step += 1;

  client.user.setPresence({
    status: "online",
    activities: [activity],
  });
}

/**
 * Rotate Discord presence with live deal counts.
 * @param {import('discord.js').Client} client
 */
function startBotPresence(client) {
  if (timer) return;
  applyPresence(client);
  timer = setInterval(() => {
    try {
      applyPresence(client);
    } catch (err) {
      console.warn("[presence]", err.message);
    }
  }, ROTATE_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log("Bot presence rotator started (15s).");
}

function stopBotPresence() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startBotPresence,
  stopBotPresence,
  countActiveDeals,
  countCompletedDeals,
  buildActivities,
};
