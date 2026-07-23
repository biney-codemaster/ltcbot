const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const slotService = require("./slotService");
const { freeKeyPanelEmbed, paidPlansPanelEmbed } = require("../utils/embeds");

function freePanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("slotkey:claim")
        .setLabel("Claim free key")
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

function buyPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("slotbuy:plan:standard")
        .setLabel("Standard · €1.5")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("slotbuy:plan:boost")
        .setLabel("Boost · €4")
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

async function editPanelMessage(client, channelId, messageId, payload) {
  if (!client || !channelId || !messageId) return false;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return false;
    await message.edit(payload);
    return true;
  } catch (err) {
    console.warn("[slots] panel sync failed:", err.message);
    return false;
  }
}

async function refreshFreePanel(client, guildId) {
  const settings = slotService.getSettings(guildId);
  return editPanelMessage(client, settings.free_panel_channel_id, settings.free_panel_message_id, {
    embeds: [freeKeyPanelEmbed(guildId)],
    components: freePanelComponents(),
  });
}

async function refreshBuyPanel(client, guildId) {
  const settings = slotService.getSettings(guildId);
  return editPanelMessage(client, settings.buy_panel_channel_id, settings.buy_panel_message_id, {
    embeds: [paidPlansPanelEmbed(guildId)],
    components: buyPanelComponents(),
  });
}

/** Refresh free + paid public panels after slot create / free-up. */
async function refreshSlotPanels(client, guildId) {
  if (!client || !guildId) return;
  await Promise.all([
    refreshFreePanel(client, guildId),
    refreshBuyPanel(client, guildId),
  ]);
}

module.exports = {
  freePanelComponents,
  buyPanelComponents,
  refreshFreePanel,
  refreshBuyPanel,
  refreshSlotPanels,
};
