const { ChannelType, PermissionFlagsBits } = require("discord.js");
const config = require("../config");

const CATEGORY_NAME = "Escrow";

/**
 * Récupère la catégorie "Escrow", la crée si elle n'existe pas.
 */
async function getOrCreateCategory(guild) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  );

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
    });
  }

  return category;
}

/**
 * Crée un salon privé pour un deal, visible uniquement par:
 * l'initiateur, le partenaire, le rôle staff (si configuré), et le bot.
 * dealCode: code aléatoire du deal (ex: "A3F9K2"), utilisé dans le nom du salon.
 */
async function createDealChannel(guild, dealCode, initiatorId, partnerId) {
  const category = await getOrCreateCategory(guild);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: initiatorId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
    {
      id: partnerId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
  ];

  if (config.staffRoleId) {
    overwrites.push({
      id: config.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
  }

  const channel = await guild.channels.create({
    name: `deal-${dealCode.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
  });

  return channel;
}

module.exports = { createDealChannel };
