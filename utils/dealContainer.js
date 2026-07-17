const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");

const { e, emojis } = config;

function applyEmoji(button, key) {
  if (emojis[key]) button.setEmoji(emojis[key]);
  return button;
}

function formatCryptoPrice(deal) {
  const crypto = deal.crypto || "LTC";
  const amount = formatLtcAmount(Number(deal.pay_amount));
  if (!amount) return `${crypto} · cours indisponible`;
  return `≈ ${amount} ${crypto}`;
}

function dealTitle(deal) {
  return `# ${e("deal")}Deal #${deal.deal_code}`;
}

function dealOverview(deal) {
  return (
    `## ${e("users")}Participants\n` +
    `<@${deal.initiator_id}> ↔ <@${deal.partner_id}>\n\n` +
    `## ${e("product")}Détails\n` +
    `**Produit** — ${deal.product}\n` +
    `**Prix** — ${deal.price}${deal.currency}\n` +
    `**Crypto** — ${formatCryptoPrice(deal)}`
  );
}

/**
 * Étape 1: sélection des rôles (Acheteur / Vendeur) + Annuler.
 */
function buildRoleSelectionContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealOverview(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const buyerLabel = deal.buyer_id ? `<@${deal.buyer_id}>` : "*en attente*";
  const sellerLabel = deal.seller_id ? `<@${deal.seller_id}>` : "*en attente*";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("roles")}Sélection des rôles\n` +
        `Chaque participant doit indiquer s'il est **acheteur** ou **vendeur** dans ce deal.\n\n` +
        `${e("buyer")}**Acheteur** — ${buyerLabel}\n` +
        `${e("seller")}**Vendeur** — ${sellerLabel}`
    )
  );

  const buyerButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_role:BUYER:${deal.deal_code}`)
      .setLabel("Acheteur")
      .setStyle(deal.buyer_id ? ButtonStyle.Success : ButtonStyle.Secondary),
    "buyer"
  );

  const sellerButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_role:SELLER:${deal.deal_code}`)
      .setLabel("Vendeur")
      .setStyle(deal.seller_id ? ButtonStyle.Success : ButtonStyle.Secondary),
    "seller"
  );

  const cancelButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_cancel:${deal.deal_code}`)
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Danger),
    "cancel"
  );

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
  const confirmCount = (deal.initiator_confirmed ? 1 : 0) + (deal.partner_confirmed ? 1 : 0);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealOverview(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Confirmation des rôles\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("warning")}Vérifiez attentivement que les rôles sont corrects avant de confirmer.\n` +
        `${e("clock")}Confirmations : **${confirmCount}/2**`
    )
  );

  const confirmButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_confirm:${deal.deal_code}`)
      .setLabel(`Confirmer (${confirmCount}/2)`)
      .setStyle(confirmCount === 2 ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(confirmCount === 2),
    "confirm"
  );

  const wrongRolesButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_wrong_roles:${deal.deal_code}`)
      .setLabel("Rôles incorrects")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(confirmCount === 2),
    "warning"
  );

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

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealOverview(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Rôles confirmés\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("shield")}Les deux parties ont validé les termes du deal.\n` +
        `${e("next")}**Prochaine étape** — génération de l'adresse de paiement ${deal.crypto || "LTC"}.`
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
    new TextDisplayBuilder().setContent(`# ${e("cancel")}Deal annulé`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}Deal #${deal.deal_code}\n` +
        `Annulé par <@${cancelledBy}>.\n\n` +
        `${e("staff")}Un membre du staff doit fermer ce salon pour finaliser l'annulation.`
    )
  );

  const closeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_close:${deal.deal_code}`)
      .setLabel("Fermer le salon")
      .setStyle(ButtonStyle.Danger),
    "close"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(closeButton));

  return container;
}

module.exports = {
  buildRoleSelectionContainer,
  buildConfirmationContainer,
  buildFinalRecapContainer,
  buildCloseTicketContainer,
};
