const slotService = require("../services/slotService");
const { revokeSlot } = require("../services/guildActions");
const config = require("../config");

function detectPings(message) {
  const content = message.content || "";
  const usedEveryone = content.includes("@everyone");
  const usedHere = content.includes("@here");

  if (usedEveryone || usedHere) {
    return { usedEveryone, usedHere };
  }

  // Fallback when Message Content Intent is missing/disabled:
  // Discord still sets mentions.everyone for @everyone / @here.
  if (message.mentions?.everyone) {
    return { usedEveryone: true, usedHere: false };
  }

  return { usedEveryone: false, usedHere: false };
}

async function sendPingCounter(message, lines) {
  const payload = {
    content: lines.join("\n"),
    allowedMentions: { parse: [], repliedUser: false },
  };

  try {
    await message.reply(payload);
    return;
  } catch (err) {
    console.error("Failed to reply ping counter:", err.message);
  }

  try {
    await message.channel.send(payload);
  } catch (err) {
    console.error("Failed to send ping counter:", err.message);
  }
}

/**
 * Enforce daily @everyone / @here limits in vendor slot channels.
 */
async function handleSlotMessage(message) {
  if (!message.guild || message.author.bot) return;

  let msg = message;
  if (msg.partial) {
    msg = await msg.fetch().catch(() => null);
    if (!msg) return;
  }

  const slot = slotService.getSlotByChannel(msg.guild.id, msg.channel.id);
  if (!slot) return;
  if (slot.user_id !== msg.author.id) return;

  const { usedEveryone, usedHere } = detectPings(msg);
  if (!usedEveryone && !usedHere) return;

  const counts = slotService.getPingCounts(slot.id);
  let exceeded = false;
  let reason = "Daily ping limit exceeded";

  if (usedEveryone && counts.everyone >= slot.max_everyone_pings) {
    exceeded = true;
    reason = `Daily @everyone limit exceeded (${slot.max_everyone_pings}/day)`;
  } else if (usedHere && counts.here >= slot.max_here_pings) {
    exceeded = true;
    reason = `Daily @here limit exceeded (${slot.max_here_pings}/day)`;
  }

  if (exceeded) {
    await msg.delete().catch(() => null);
    await revokeSlot(msg.client, slot, reason);
    return;
  }

  const lines = [];

  if (usedEveryone) {
    const updated = slotService.incrementEveryonePing(slot.id);
    lines.push(`\`@everyone ping used: ${updated.everyone}/${slot.max_everyone_pings}\``);
  }

  if (usedHere) {
    const updated = slotService.incrementHerePing(slot.id);
    lines.push(`\`@here ping used: ${updated.here}/${slot.max_here_pings}\``);
  }

  const dealChannelId = config.startDealChannelId;
  if (dealChannelId) {
    lines.push(`Start a deal → <#${dealChannelId}>`);
  }

  if (lines.length) {
    await sendPingCounter(msg, lines);
  }
}

module.exports = { handleSlotMessage };
