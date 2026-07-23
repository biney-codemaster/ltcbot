const { EmbedBuilder } = require('discord.js');
const { formatDuration, formatTimestamp } = require('./helpers');
const config = require('../config');

const COLOR = 0x2b2d31;

function baseEmbed(title) {
  return new EmbedBuilder().setColor(COLOR).setTitle(title).setTimestamp();
}

function slotEmbed(slot, title = 'Vendor slot') {
  const remaining = formatDuration(slot.expires_at - Date.now());

  return baseEmbed(title).addFields(
    { name: 'User', value: `<@${slot.user_id}>`, inline: true },
    { name: 'Channel', value: slot.channel_id ? `<#${slot.channel_id}>` : 'None', inline: true },
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
      `Welcome <@${slot.user_id}> — this is **your** private vendor slot channel.\n\n` +
        '**Products only. Nestoo - Middleman mandatory.**'
    )
    .addFields(
      {
        name: 'Channel permissions',
        value:
          '• Only **you** can send messages here\n' +
          '• Everyone else can view, but cannot write\n' +
          '• Use this channel to post your product ads / offers only',
      },
      {
        name: 'Duration',
        value:
          `• Created: ${formatTimestamp(slot.created_at)}\n` +
          `• Expires: ${formatTimestamp(slot.expires_at)}\n` +
          `• Time left: **${formatDuration(slot.expires_at - Date.now())}**`,
      },
      {
        name: 'Daily ping limits',
        value:
          `• \`@everyone\`: **${slot.max_everyone_pings}** / day\n` +
          `• \`@here\`: **${slot.max_here_pings}** / day\n` +
          '• Limits reset every day at **midnight (Paris time)**\n' +
          '• After each ping, the bot posts your usage counter under your message',
      },
      {
        name: 'Selling rules',
        value:
          '• **Only sell your products** — nothing else\n' +
          '• **Forbidden:** Discord server promotion, invites, recruiting, community ads\n' +
          '• **Mandatory:** every transaction must go through **Nestoo - Middleman**\n' +
          '• This protects buyers and sellers from scams',
      },
      {
        name: 'Buyer notice',
        value:
          'If a buyer refuses **Nestoo - Middleman** and gets scammed, that is **their own risk**.\n' +
          'The server / staff are **not responsible** for deals made outside the middleman bot.',
      },
      {
        name: 'Ping abuse',
        value:
          '• Stay within your daily ping limits\n' +
          '• **Exceeding a ping limit instantly revokes your slot**\n' +
          '• Revoke = role removed + this channel deleted\n' +
          '• After revoke / expiry, contact an owner for a new slot',
      },
      {
        name: 'Tips',
        value:
          '• You can post as many normal messages as you want\n' +
          '• Only `@everyone` and `@here` are limited\n' +
          '• Embeds, images and links are allowed',
      }
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
      'Claim a **one-time free key**, then activate it to get your own vendor slot channel.\n\n' +
        '**Products only** — no Discord server ads.\n' +
        '**Nestoo - Middleman is mandatory** for every transaction.'
    )
    .addFields(
      {
        name: 'How it works',
        value:
          '1. Click **Claim free key** below\n' +
          '2. Copy your unique key\n' +
          `3. Run \`/slot activate key:YOUR-KEY\`\n` +
          '4. Your private slot channel is created automatically',
      },
      {
        name: 'Free slot includes',
        value:
          `• Duration: **${config.freeSlotDays} days** (1 month)\n` +
          `• **${config.freeEveryonePings}** \`@everyone\` ping / day\n` +
          `• **${config.freeHerePings}** \`@here\` ping / day\n` +
          '• Private channel (only you can send messages)\n' +
          '• Ping limits reset at **midnight (Paris time)**',
      },
      {
        name: 'Rules',
        value:
          '• **1 key per user** (unique, non-transferable)\n' +
          '• A key can only be activated **once**\n' +
          '• You cannot claim another free key later\n' +
          '• **Only sell your products** — nothing else\n' +
          '• **Forbidden:** Discord server promotion, invites, recruiting, community ads\n' +
          '• **Mandatory:** use **Nestoo - Middleman** for every deal (anti-scam)\n' +
          '• **Exceeding daily ping limits instantly revokes your slot**\n' +
          '• Keep your key private',
      },
      {
        name: 'Requirements',
        value:
          '• You must be in this server\n' +
          '• You must not already have an active slot\n' +
          '• Enable DMs if you want a backup copy of the key (optional)',
      }
    );
}

function claimedKeyEmbed(key) {
  const status = key.used_at
    ? 'Already used — this key cannot activate another slot.'
    : 'Unused — activate it with `/slot activate`.';

  return baseEmbed('Your free slot key')
    .setColor(key.used_at ? 0xed4245 : 0x57f287)
    .setDescription(
      `Your unique key:\n\`\`\`\n${key.key_code}\n\`\`\`\n` +
        `Status: **${status}**\n\n` +
        'Next step:\n' +
        `\`/slot activate key:${key.key_code}\`\n\n` +
        `Free slot: **${config.freeSlotDays} days** · ` +
        `**${config.freeEveryonePings}** @everyone / day · ` +
        `**${config.freeHerePings}** @here / day\n` +
        'Exceeding ping limits = **slot revoked**.'
    );
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
};
