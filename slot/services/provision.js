const slotService = require("./slotService");
const {
  addSlotRole,
  sendLog,
  createSlotChannel,
  postSlotGuide,
} = require("./guildActions");
const { slotEmbed } = require("../utils/embeds");
const { getPlan } = require("../plans");

/**
 * Create Discord channel + DB slot + role + guide.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {{ planId: string, days?: number, everyonePings?: number, herePings?: number, title?: string }} opts
 */
async function provisionSlot(guild, user, opts) {
  const plan = getPlan(opts.planId) || getPlan("free");
  const days = opts.days ?? plan.days;
  const everyonePings = opts.everyonePings ?? plan.everyonePings;
  const herePings = opts.herePings ?? plan.herePings;
  const title = opts.title || `${plan.name} slot`;

  const settings = slotService.getSettings(guild.id);

  let channel;
  try {
    channel = await createSlotChannel(guild, user);
  } catch (err) {
    console.error("Failed to create slot channel:", err);
    return {
      error: "Could not create the slot channel. Check bot permissions (Manage Channels).",
    };
  }

  const slot = slotService.createSlot({
    guildId: guild.id,
    userId: user.id,
    channelId: channel.id,
    maxEveryonePings: everyonePings,
    maxHerePings: herePings,
    durationDays: days,
    plan: plan.id,
  });

  await postSlotGuide(channel, slot);
  await addSlotRole(guild, user.id, settings.slot_role_id);
  await sendLog(guild, `Slot created for <@${user.id}> (${plan.name}).`, [
    slotEmbed(slot, title),
  ]);

  return { slot, channel, plan };
}

module.exports = { provisionSlot };
