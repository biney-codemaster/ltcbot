const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");

function formatCryptoPrice(deal) {
  const crypto = deal.crypto || "LTC";
  const amount = formatLtcAmount(Number(deal.pay_amount));
  if (!amount) return `${crypto} (cours indisponible)`;
  return `≈ ${amount} ${crypto}`;
}

function dealHeader(deal) {
  return (
    `${config.emojiText.deal} **Deal #${deal.deal_code}**\n` +
    `<@${deal.initiator_id}> ↔ <@${deal.partner_id}>\n\n` +
    `Produit: ${deal.product}\n` +
    `Prix: ${deal.price}${deal.currency} (${formatCryptoPrice(deal)})`
  );
}

/**
 * Étape 1: sélection des rôles (Acheteur / Vendeur) + Annuler.
 */
function buildRoleSelectionContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealHeader(deal)));
  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Vous devez chacun choisir votre rôle dans ce deal (Acheteur ou Vendeur)."
    )
  );

  const buyerLabel = deal.buyer_id ? `<@${deal.buyer_id}>` : "en attente";
  const sellerLabel = deal.seller_id ? `<@${deal.seller_id}>` : "en attente";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`Acheteur: ${buyerLabel}\nVendeur: ${sellerLabel}`)
  );

  const buyerButton = new ButtonBuilder()
    .setCustomId(`deal_role:BUYER:${deal.deal_code}`)
    .setLabel("Acheteur")
    .setStyle(deal.buyer_id ? ButtonStyle.Success : ButtonStyle.Secondary);

  const sellerButton = new ButtonBuilder()
    .setCustomId(`deal_role:SELLER:${deal.deal_code}`)
    .setLabel("Vendeur")
    .setStyle(deal.seller_id ? ButtonStyle.Success : ButtonStyle.Secondary);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`deal_cancel:${deal.deal_code}`)
    .setLabel("Annuler")
    .setStyle(ButtonStyle.Danger);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(buyerButton, sellerButton, cancelButton)
  );

  return container;
}

/**
 * Étape 2: récap des rôles + confirmation des deux participants.
 */
function buildConfirmationContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealHeader(deal)));
  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Acheteur: <@${deal.buyer_id}>\nVendeur: <@${deal.seller_id}>\n\n` +
        `Vérifiez que les rôles sont corrects avant de confirmer.`
    )
  );

  const confirmCount = deal.initiator_confirmed + deal.partner_confirmed;

  const confirmButton = new ButtonBuilder()
    .setCustomId(`deal_confirm:${deal.deal_code}`)
    .setLabel(`Confirmer (${confirmCount}/2)`)
    .setStyle(confirmCount === 2 ? ButtonStyle.Success : ButtonStyle.Primary)
    .setDisabled(confirmCount === 2);

  const wrongRolesButton = new ButtonBuilder()
    .setCustomId(`deal_wrong_roles:${deal.deal_code}`)
    .setLabel("Rôles incorrects")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(confirmCount === 2);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(confirmButton, wrongRolesButton)
  );

  return container;
}

/**
 * Étape 3: récap final une fois les rôles confirmés par les deux parties.
 */
function buildFinalRecapContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealHeader(deal)));
  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Acheteur: <@${deal.buyer_id}>\nVendeur: <@${deal.seller_id}>\n\n` +
        `${config.emojiText.money} Rôles confirmés par les deux parties.\n` +
        `Prochaine étape: génération de l'adresse de paiement.`
    )
  );

  return container;
}

/**
 * Container envoyé quand un participant annule le deal.
 * Seul le staff peut effectivement fermer le salon.
 */
function buildCloseTicketContainer(deal, cancelledBy) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${config.emojiText.info} **Deal #${deal.deal_code} annulé** par <@${cancelledBy}>.\n` +
        `Un membre du staff doit fermer ce salon.`
    )
  );

  const closeButton = new ButtonBuilder()
    .setCustomId(`deal_close:${deal.deal_code}`)
    .setLabel("Fermer le salon")
    .setStyle(ButtonStyle.Danger);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(closeButton));

  return container;
}

module.exports = {
  buildRoleSelectionContainer,
  buildConfirmationContainer,
  buildFinalRecapContainer,
  buildCloseTicketContainer,
};
