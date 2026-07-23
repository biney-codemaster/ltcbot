const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const config = require("../config");
const slotService = require("../services/slotService");
const keyService = require("../services/keyService");
const { isOwner } = require("../utils/helpers");
const {
  listEmbed,
  panelEmbed,
  errorEmbed,
  claimedKeyEmbed,
  invoiceEmbed,
  successEmbed,
  warnEmbed,
} = require("../utils/embeds");
const {
  startSlotPurchase,
  formatInvoiceLines,
  SUPPORTED_CRYPTOS,
  assertCanBuy,
} = require("../services/slotPayment");
const { getPlan } = require("../plans");
const { checkPurchaseNow } = require("../services/slotPaymentPoller");
const purchaseService = require("../services/purchaseService");
const nestooConfig = require("../../config");
const { CRYPTO_ASSETS } = require("../../utils/cryptoAssets");

function cryptoSelectRow(planId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`slotbuy:crypto:${planId}`)
    .setPlaceholder("Choose crypto to pay with")
    .addOptions(
      SUPPORTED_CRYPTOS.map((code) => {
        const asset = CRYPTO_ASSETS[code];
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(asset.label)
          .setValue(code)
          .setDescription(`Pay € with ${asset.name}`);
        const emoji = nestooConfig.emojis[asset.emojiKey] || nestooConfig.emojis.crypto;
        if (emoji) opt.setEmoji(emoji);
        return opt;
      })
    );
  return new ActionRowBuilder().addComponents(menu);
}

function invoiceComponents(purchaseId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`slotpay:check:${purchaseId}`)
        .setLabel("I paid — check")
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

/**
 * Handle slot buttons / selects. Returns true if handled.
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
            "You already used your free key.\n" +
              "Buy a **Standard** or **Boost** slot on the paid panel."
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

  if (interaction.isButton() && interaction.customId.startsWith("slotbuy:plan:")) {
    const planId = interaction.customId.split(":")[2];
    const plan = getPlan(planId);
    if (!plan?.paid) {
      await interaction.reply({
        embeds: [errorEmbed("Unknown plan.")],
        ephemeral: true,
      });
      return true;
    }

    const gate = assertCanBuy(interaction.guildId, interaction.user.id, planId);
    if (!gate.ok) {
      await interaction.reply({
        embeds: [errorEmbed(gate.error)],
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          `**${plan.name}** — €${plan.priceEur}/mo\n` +
            `${plan.everyonePings} @everyone · ${plan.herePings} @here / day · ${plan.days} days\n` +
            "Pick a crypto below."
        ),
      ],
      components: [cryptoSelectRow(planId)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("slotbuy:crypto:")) {
    const planId = interaction.customId.split(":")[2];
    const crypto = interaction.values[0];
    await interaction.deferUpdate();

    const started = await startSlotPurchase({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      planId,
      crypto,
      channelId: interaction.channelId,
    });

    if (!started.ok) {
      await interaction.followUp({
        embeds: [errorEmbed(started.error)],
        ephemeral: true,
      });
      return true;
    }

    const lines = formatInvoiceLines(started.purchase, started.plan);
    const embed = invoiceEmbed(started.purchase, started.plan, lines.description);
    const components = invoiceComponents(started.purchase.id);

    await interaction.user.send({ embeds: [embed], components }).catch(() => null);
    await interaction.followUp({
      embeds: [embed],
      components,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith("slotpay:check:")) {
    const purchaseId = Number(interaction.customId.split(":")[2]);
    await interaction.deferReply({ ephemeral: true });

    const purchase = purchaseService.getPurchase(purchaseId);
    if (!purchase) {
      await interaction.editReply({ embeds: [errorEmbed("Invoice not found.")] });
      return true;
    }
    if (purchase.user_id !== interaction.user.id && !isOwner(interaction.user.id, config.ownerId)) {
      await interaction.editReply({ embeds: [errorEmbed("Not your invoice.")] });
      return true;
    }

    const result = await checkPurchaseNow(purchaseId);
    if (!result.ok) {
      await interaction.editReply({ embeds: [errorEmbed(result.error)] });
      return true;
    }

    const fresh = result.purchase;
    if (fresh.status === "completed") {
      await interaction.editReply({
        embeds: [successEmbed("Payment confirmed — your slot is ready.")],
      });
      return true;
    }

    await interaction.editReply({
      embeds: [
        warnEmbed(
          `Status: **${fresh.payment_status || fresh.status}**\n` +
            `Send exact amount to:\n\`${fresh.pay_address}\`\n` +
            "I'll keep watching automatically."
        ),
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
