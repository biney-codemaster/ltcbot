const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../config");
const slotService = require("../services/slotService");
const keyService = require("../services/keyService");
const { isOwner } = require("../utils/helpers");
const {
  listEmbed,
  panelEmbed,
  errorEmbed,
  claimedKeyEmbed,
} = require("../utils/embeds");

/**
 * Handle slot buttons (key claim + owner panel). Returns true if handled.
 */
async function handleSlotInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === "slotkey:claim") {
    await interaction.deferReply({ ephemeral: true });

    const result = keyService.claimKey(interaction.guildId, interaction.user.id);
    if (!result.ok) {
      await interaction.editReply({
        embeds: [errorEmbed("Could not generate a key. Please try again.")],
      });
      return true;
    }

    const { key, created } = result;

    if (key.used_at) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "You already claimed and used your free key.\n" +
              "Only **one free key per user** is allowed.\n" +
              "Ask an owner if you need a paid slot."
          ),
        ],
      });
      return true;
    }

    await interaction.user.send({ embeds: [claimedKeyEmbed(key)] }).catch(() => null);

    await interaction.editReply({
      embeds: [
        claimedKeyEmbed(key).setFooter({
          text: created
            ? "Key created — copy it now and keep it private."
            : "You already had an unused key — here it is again.",
        }),
      ],
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith("slotpanel:")) {
    if (!config.ownerId || !isOwner(interaction.user.id, config.ownerId)) {
      await interaction.reply({
        embeds: [errorEmbed("Only the bot owner can use this panel.")],
        ephemeral: true,
      });
      return true;
    }

    const action = interaction.customId.split(":")[1];
    const settings = slotService.getSettings(interaction.guildId);
    const slots = slotService.listSlots(interaction.guildId);

    if (action === "list") {
      await interaction.reply({
        embeds: [listEmbed(slots)],
        ephemeral: true,
      });
      return true;
    }

    if (action === "refresh") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("slotpanel:list")
          .setLabel("List slots")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("slotpanel:refresh")
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        embeds: [panelEmbed(settings, slots.length)],
        components: [row],
      });
      return true;
    }
  }

  return false;
}

module.exports = { handleSlotInteraction };
