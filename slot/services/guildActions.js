const { ChannelType, PermissionFlagsBits } = require('discord.js');
const slotService = require('./slotService');
const { refreshSlotPanels } = require('./panelSync');
const { slotEmbed, warnEmbed, noticeEmbed, slotChannelGuideEmbed } = require('../utils/embeds');
const { sanitizeChannelName } = require('../utils/helpers');

async function addSlotRole(guild, userId, roleId) {
  if (!roleId) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  const role = guild.roles.cache.get(roleId);
  if (!member || !role) return;
  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(roleId).catch(() => null);
  }
}

async function removeSlotRole(guild, userId, roleId) {
  if (!roleId) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(roleId).catch(() => null);
  }
}

async function sendLog(guild, content, embeds = []) {
  const settings = slotService.getSettings(guild.id);
  if (!settings.log_channel_id) return;

  const channel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({ content, embeds }).catch(() => null);
}

async function notifyUser(client, userId, payload) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;
  await user.send(payload).catch(() => null);
}

async function createSlotChannel(guild, user) {
  const settings = slotService.getSettings(guild.id);
  const botMember = guild.members.me;

  const overwrites = [
    {
      id: guild.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads],
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.MentionEveryone,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (botMember) {
    overwrites.push({
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: sanitizeChannelName(user.username),
    type: ChannelType.GuildText,
    parent: settings.category_id || undefined,
    topic: `Vendor slot for ${user.tag}`,
    permissionOverwrites: overwrites,
    reason: `Slot created for ${user.tag}`,
  });

  return channel;
}

async function postSlotGuide(channel, slot) {
  await channel
    .send({
      content: `<@${slot.user_id}>`,
      embeds: [slotChannelGuideEmbed(slot)],
    })
    .catch(() => null);
}

async function deleteSlotChannel(guild, channelId) {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  await channel.delete('Slot removed / expired').catch(() => null);
}

async function revokeSlot(client, slot, reason = 'Ping limit exceeded') {
  const guild = await client.guilds.fetch(slot.guild_id).catch(() => null);
  if (!guild) {
    slotService.deleteSlot(slot.guild_id, slot.user_id);
    await refreshSlotPanels(client, slot.guild_id);
    return;
  }

  const settings = slotService.getSettings(guild.id);
  const channelId = slot.channel_id;

  await removeSlotRole(guild, slot.user_id, settings.slot_role_id);

  const deleted = slotService.deleteSlot(slot.guild_id, slot.user_id);

  if (channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel
        .send({
          content: `<@${slot.user_id}>`,
          embeds: [
            warnEmbed(
              `This slot has been **revoked**.\nReason: ${reason}\nThe channel will be deleted.`
            ),
          ],
        })
        .catch(() => null);
    }
  }

  await deleteSlotChannel(guild, channelId);

  await sendLog(
    guild,
    `Slot revoked for <@${slot.user_id}> — ${reason}`,
    deleted ? [slotEmbed(deleted, 'Slot revoked')] : []
  );

  await notifyUser(client, slot.user_id, {
    embeds: [
      warnEmbed(
        `Your vendor slot on **${guild.name}** was **revoked**.\nReason: ${reason}`
      ),
    ],
  });

  await refreshSlotPanels(client, guild.id);
}

async function handleExpiration(client, slot) {
  const guild = await client.guilds.fetch(slot.guild_id).catch(() => null);
  if (!guild) {
    slotService.deleteSlot(slot.guild_id, slot.user_id);
    await refreshSlotPanels(client, slot.guild_id);
    return;
  }

  const settings = slotService.getSettings(guild.id);
  await removeSlotRole(guild, slot.user_id, settings.slot_role_id);
  await deleteSlotChannel(guild, slot.channel_id);

  const deleted = slotService.deleteSlot(slot.guild_id, slot.user_id);

  await sendLog(
    guild,
    `Slot expired for <@${slot.user_id}>.`,
    deleted ? [slotEmbed(deleted, 'Slot expired')] : []
  );

  await notifyUser(client, slot.user_id, {
    embeds: [
      noticeEmbed(
        'Slot expired',
        `Your vendor slot on **${guild.name}** has expired.\nContact an owner to renew it.`
      ),
    ],
  });

  await refreshSlotPanels(client, guild.id);
}

async function handleWarning(client, slot) {
  const guild = await client.guilds.fetch(slot.guild_id).catch(() => null);
  if (!guild) return;

  slotService.markWarned(slot.id);

  await sendLog(guild, `Expiry notice for <@${slot.user_id}>.`, [
    slotEmbed(slot, 'Slot expiring soon'),
  ]);

  await notifyUser(client, slot.user_id, {
    embeds: [
      noticeEmbed(
        'Slot expiring soon',
        `Your vendor slot on **${guild.name}** is expiring soon.\n` +
          `Expires: <t:${Math.floor(slot.expires_at / 1000)}:R>`
      ),
    ],
  });
}

function startExpirationLoop(client, intervalMs) {
  const tick = async () => {
    try {
      const warnings = slotService.getSlotsNeedingWarning();
      for (const slot of warnings) {
        await handleWarning(client, slot);
      }

      const expired = slotService.getExpiredSlots();
      for (const slot of expired) {
        await handleExpiration(client, slot);
      }
    } catch (err) {
      console.error('Expiration loop error:', err);
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}

module.exports = {
  addSlotRole,
  removeSlotRole,
  sendLog,
  createSlotChannel,
  postSlotGuide,
  deleteSlotChannel,
  revokeSlot,
  startExpirationLoop,
};
