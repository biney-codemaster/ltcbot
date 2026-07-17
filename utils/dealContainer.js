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
const { statusLabel } = require("./ltcWallet");

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

function addStandardHeader(container, deal) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealOverview(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
}

function buildRoleSelectionContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

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

function buildConfirmationContainer(deal) {
  const container = new ContainerBuilder();
  const confirmCount = (deal.initiator_confirmed ? 1 : 0) + (deal.partner_confirmed ? 1 : 0);
  addStandardHeader(container, deal);

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

function buildFinalRecapContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

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

function buildPaymentContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const address = deal.pay_address || "*adresse en cours de génération*";
  const status = statusLabel(deal.payment_status || "waiting");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("payment")}Paiement escrow
` +
        `${e("buyer")}<@${deal.buyer_id}> doit envoyer exactement le montant ci-dessous.

` +
        `${e("ltc")}**Montant** — \`${amount} ${deal.crypto || "LTC"}\`
` +
        `${e("wallet")}**Adresse**
\`\`\`
${address}
\`\`\`
` +
        `${e("clock")}**Statut** — ${status}

` +
        `${e("warning")}N'envoyez que du **${deal.crypto || "LTC"}** à cette adresse. Tout autre envoi peut être perdu.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      applyEmoji(
        new ButtonBuilder()
          .setCustomId(`deal_check_payment:${deal.deal_code}`)
          .setLabel("Vérifier le paiement")
          .setStyle(ButtonStyle.Primary),
        "payment"
      ),
      applyEmoji(
        new ButtonBuilder()
          .setCustomId(`deal_dispute:${deal.deal_code}`)
          .setLabel("Ouvrir un litige")
          .setStyle(ButtonStyle.Danger),
        "dispute"
      )
    )
  );
  return container;
}

/** Affiché si la création d'invoice a échoué (retry possible). */
function buildPaymentSetupErrorContainer(deal, errorMessage) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  const isMin =
    /montant trop|too small|minimum|frais réseau|DUST|solde trop bas/i.test(
      String(errorMessage || "")
    );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Adresse de paiement indisponible\n` +
        `Erreur : \`${errorMessage || "inconnue"}\`\n\n` +
        (isMin
          ? `${e("info")}Montant trop bas pour couvrir les frais réseau Litecoin. Augmente légèrement le prix.`
          : `${e("next")}Réessayez — le wallet local régénère une nouvelle adresse.`)
    )
  );

  const retryButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_regen_payment:${deal.deal_code}`)
      .setLabel("Régénérer l'adresse")
      .setStyle(ButtonStyle.Primary),
    "payment"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(retryButton));
  return container;
}

function buildPaymentFailedContainer(deal, reason) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Paiement non finalisé\n` +
        `Statut : **${reason}**\n\n` +
        `${e("next")}Vous pouvez générer une nouvelle adresse, ou contacter le staff si des fonds ont déjà été envoyés.`
    )
  );

  const retryButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_regen_payment:${deal.deal_code}`)
      .setLabel("Nouvelle adresse")
      .setStyle(ButtonStyle.Primary),
    "payment"
  );

  const disputeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_dispute:${deal.deal_code}`)
      .setLabel("Ouvrir un litige")
      .setStyle(ButtonStyle.Danger),
    "dispute"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(retryButton, disputeButton)
  );

  return container;
}

function buildFundsHeldContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  const walletLine = deal.seller_wallet
    ? `${e("wallet")}**Adresse vendeur** — \`${deal.seller_wallet}\``
    : `${e("warning")}**Adresse vendeur** — non renseignée (obligatoire avant libération)`;

  const payoutErrorLine = deal.payout_error
    ? `\n\n${e("error")}**Dernier payout échoué** — \`${deal.payout_error}\`\nVous pouvez réessayer la libération.`
    : "";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("shield")}Fonds sécurisés\n` +
        `${e("success")}Le paiement a été reçu et est conservé sur une **adresse escrow dédiée** (wallet local).\n\n` +
        `${e("seller")}<@${deal.seller_id}> — livrez le produit à l'acheteur.\n` +
        `${e("buyer")}<@${deal.buyer_id}> — confirmez uniquement après réception.\n\n` +
        `${walletLine}${payoutErrorLine}`
    )
  );

  const walletButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_seller_wallet:${deal.deal_code}`)
      .setLabel(deal.seller_wallet ? "Modifier mon adresse" : "Adresse de retrait")
      .setStyle(ButtonStyle.Secondary),
    "wallet"
  );

  const releaseButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_release:${deal.deal_code}`)
      .setLabel(deal.payout_error ? "Réessayer la libération" : "Produit reçu — libérer")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!deal.seller_wallet),
    "release"
  );

  const disputeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_dispute:${deal.deal_code}`)
      .setLabel("Ouvrir un litige")
      .setStyle(ButtonStyle.Danger),
    "dispute"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(walletButton, releaseButton, disputeButton)
  );

  return container;
}

function buildReleasedContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  const payoutStatus = deal.payout_status || "unknown";
  const wallet = deal.seller_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";

  let payoutText;
  if (deal.payout_error) {
    payoutText =
      `${e("error")}Échec du payout automatique : \`${deal.payout_error}\`\n` +
      `${e("staff")}Libérez manuellement depuis une wallet LTC avec la seed escrow vers \`${wallet}\`.`;
  } else {
    payoutText =
      `${e("success")}Payout initié vers le vendeur.\n` +
      `${e("wallet")}\`${wallet}\`\n` +
      `${e("ltc")}**Montant** — \`${amount} ${deal.crypto || "LTC"}\`\n` +
      `${e("clock")}**Statut payout** — ${statusLabel(payoutStatus)}`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("release")}Deal terminé\n` +
        `${e("success")}L'acheteur a confirmé la réception du produit.\n\n` +
        `${payoutText}\n\n` +
        `${e("staff")}Le staff peut fermer ce salon une fois le payout confirmé.`
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

function buildDisputeContainer(deal, openedBy) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("dispute")}Litige ouvert\n` +
        `Ouvert par <@${openedBy}>.\n\n` +
        `**Motif**\n${deal.dispute_reason || "*non précisé*"}\n\n` +
        `${e("staff")}Un médiateur doit trancher : libérer au vendeur, ou clôturer sans payout auto.`
    )
  );

  const releaseButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_release:${deal.deal_code}`)
      .setLabel("Staff: libérer vendeur")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!deal.seller_wallet),
    "release"
  );

  const resolveButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_resolve:${deal.deal_code}`)
      .setLabel("Staff: clôturer litige")
      .setStyle(ButtonStyle.Secondary),
    "staff"
  );

  const closeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_close:${deal.deal_code}`)
      .setLabel("Fermer le salon")
      .setStyle(ButtonStyle.Danger),
    "close"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(releaseButton, resolveButton, closeButton)
  );
  return container;
}

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
  buildPaymentContainer,
  buildPaymentSetupErrorContainer,
  buildPaymentFailedContainer,
  buildFundsHeldContainer,
  buildReleasedContainer,
  buildDisputeContainer,
  buildCloseTicketContainer,
};
