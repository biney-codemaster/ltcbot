const { EmbedBuilder } = require('discord.js');
const { formatDuration, formatTimestamp } = require('./helpers');
const config = require('../config');
const { PLANS } = require('../plans');
const slotService = require('../services/slotService');

const COLOR = 0x2b2d31;

function baseEmbed(title) {
  return new EmbedBuilder().setColor(COLOR).setTitle(title).setTimestamp();
}

function dealChannelHint() {
  const id = config.startDealChannelId;
  return id ? `Start deals in <#${id}>` : 'Start deals via **Nestoo - Middleman**';
}

function slotEmbed(slot, title = 'Vendor slot') {
  const remaining = formatDuration(slot.expires_at - Date.now());
  const planName = PLANS[slot.plan]?.name || slot.plan || 'Free';

  return baseEmbed(title).addFields(
    { name: 'User', value: `<@${slot.user_id}>`, inline: true },
    { name: 'Channel', value: slot.channel_id ? `<#${slot.channel_id}>` : 'None', inline: true },
    { name: 'Plan', value: planName, inline: true },
    {
      name: 'Ping limits / day',
      value: `@everyone: **${slot.max_everyone_pings}**\n@here: **${slot.max_here_pings}**`,
      inline: true,
    },
    { name: 'Expires', value: formatTimestamp(slot.expires_at), inline: false },
    { name: 'Time left', value: remaining, inline: true },
    { name: 'Created', value: formatTimestamp(slot.created_at), inline: true }
  );
}

function listEmbed(slots) {
  const embed = baseEmbed(`Active slots (${slots.length})`);

  if (!slots.length) {
    return embed.setDescription('No active slots.');
  }

  const lines = slots.slice(0, 25).map((slot, i) => {
    const channel = slot.channel_id ? `<#${slot.channel_id}>` : 'no channel';
    return `**${i + 1}.** <@${slot.user_id}> — ${channel} — expires ${formatTimestamp(slot.expires_at)}`;
  });

  return embed.setDescription(lines.join('\n'));
}

function successEmbed(description) {
  return baseEmbed('Success').setDescription(description).setColor(0x57f287);
}

function errorEmbed(description) {
  return baseEmbed('Error').setDescription(description).setColor(0xed4245);
}

function warnEmbed(description) {
  return baseEmbed('Warning').setDescription(description).setColor(0xfee75c);
}

function noticeEmbed(title, description) {
  return baseEmbed(title).setDescription(description).setColor(0x5865f2);
}

function slotChannelGuideEmbed(slot) {
  return baseEmbed('Your Vendor Slot')
    .setColor(0x57f287)
    .setDescription(
      `<@${slot.user_id}> — private ads channel. **Products only.** Nestoo middleman **mandatory**.\n\n` +
        `Expires ${formatTimestamp(slot.expires_at)} · **${formatDuration(slot.expires_at - Date.now())}** left\n` +
        `Pings / day: **${slot.max_everyone_pings}** \`@everyone\` · **${slot.max_here_pings}** \`@here\` (reset midnight Paris)\n` +
        `Over limit = **slot revoked** (role + channel gone)\n\n` +
        `${dealChannelHint()}`
    );
}

function panelEmbed(settings, slotsCount) {
  return baseEmbed('Admin panel — Slotbot')
    .setDescription('Quick vendor slot management.')
    .addFields(
      {
        name: 'Slot role',
        value: settings.slot_role_id ? `<@&${settings.slot_role_id}>` : 'Not set',
        inline: true,
      },
      {
        name: 'Log channel',
        value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'Not set',
        inline: true,
      },
      {
        name: 'Category',
        value: settings.category_id ? `<#${settings.category_id}>` : 'Not set',
        inline: true,
      },
      {
        name: 'Default @everyone / day',
        value: String(settings.default_everyone_pings),
        inline: true,
      },
      {
        name: 'Default @here / day',
        value: String(settings.default_here_pings),
        inline: true,
      },
      {
        name: 'Expiry DM notice',
        value: `${settings.warn_hours}h before expiry`,
        inline: true,
      },
      { name: 'Active slots', value: String(slotsCount), inline: true }
    );
}

function freeKeyPanelEmbed() {
  return baseEmbed('Free Vendor Slot')
    .setDescription(
      'Claim **1 free key** → `/slot activate` → get your ads channel.\n\n' +
        `**${config.freeSlotDays} days** · **${config.freeEveryonePings}** \`@everyone\` / day · **${config.freeHerePings}** \`@here\` / day\n` +
        'Products only · Nestoo middleman **mandatory** · over ping limit = **revoked**\n' +
        '1 key / user · non-transferable · keep it private'
    );
}

function claimedKeyEmbed(key) {
  const status = key.used_at
    ? 'Already used.'
    : 'Unused — activate now.';

  return baseEmbed('Your free slot key')
    .setColor(key.used_at ? 0xed4245 : 0x57f287)
    .setDescription(
      `\`\`\`\n${key.key_code}\n\`\`\`\n` +
        `**${status}**\n` +
        `\`/slot activate key:${key.key_code}\`\n` +
        `${config.freeSlotDays}d · ${config.freeEveryonePings} @everyone · ${config.freeHerePings} @here / day`
    );
}

function paidPlansPanelEmbed(guildId) {
  const freeUsed = slotService.countFreeSlots(guildId);
  const paidUsed = slotService.countPaidSlots(guildId);
  const s = PLANS.standard;
  const b = PLANS.boost;

  return baseEmbed('Paid Vendor Slots')
    .setDescription(
      'Pay in **LTC only** — no middleman. Exact amount → slot created automatically.\n\n' +
        `**${s.name}** — **€${s.priceEur}/mo** · ${s.everyonePings} @everyone · ${s.herePings} @here / day\n` +
        `**${b.name}** — **€${b.priceEur}/mo** · ${b.everyonePings} @everyone · ${b.herePings} @here / day\n\n` +
        `Slots left: free **${Math.max(0, config.maxFreeSlots - freeUsed)}/${config.maxFreeSlots}** · ` +
        `paid **${Math.max(0, config.maxPaidSlots - paidUsed)}/${config.maxPaidSlots}**\n` +
        'Products only · Nestoo middleman **mandatory** for sales · over ping limit = revoked'
    );
}

function invoiceEmbed(purchase, plan, description) {
  return baseEmbed(`${plan.name} — pay with LTC`)
    .setColor(0xfaa61a)
    .setDescription(description);
}

module.exports = {
  slotEmbed,
  listEmbed,
  successEmbed,
  errorEmbed,
  warnEmbed,
  noticeEmbed,
  slotChannelGuideEmbed,
  panelEmbed,
  freeKeyPanelEmbed,
  claimedKeyEmbed,
  paidPlansPanelEmbed,
  invoiceEmbed,
  dealChannelHint,
};
