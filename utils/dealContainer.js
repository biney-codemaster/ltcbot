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
const { statusLabel, getExplorerTxUrl } = require("./ltcWallet");
const { formatAuthor } = require("./userPrefs");
const { dealCodeTag, formatCryptoAmountLine, discordTimestamp } = require("./dealLogger");

const { e, emojis } = config;

function applyEmoji(button, key) {
  if (emojis[key]) button.setEmoji(emojis[key]);
  return button;
}

function dealTitle(deal) {
  return `# ${e("deal")}Deal #${dealCodeTag(deal.deal_code)}`;
}

function addTitleOnly(container, deal) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
}

function formatTxBlock(txid) {
  const id = String(txid || "").trim();
  if (!id) return null;
  if (/^[a-f0-9]{64}$/i.test(id)) {
    return `${e("info")}**TXID** — \`${id}\` · [Lien](${getExplorerTxUrl(id)})`;
  }
  return `${e("info")}**TXID** — \`${id}\``;
}

function buildRoleSelectionContainer(deal) {
  const container = new ContainerBuilder();
  addTitleOnly(container, deal);

  const crypto = deal.crypto || "LTC";
  const amount = formatLtcAmount(Number(deal.pay_amount));
  const buyerLabel = deal.buyer_id ? `<@${deal.buyer_id}>` : "*en attente*";
  const sellerLabel = deal.seller_id ? `<@${deal.seller_id}>` : "*en attente*";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("product")}**Produit** — ${deal.product}\n` +
        `${e("money")}**Prix** — ${deal.price}${deal.currency}` +
        (amount ? `\n${e("ltc")}**${crypto}** — \`${amount} ${crypto}\`` : "") +
        `\n\n## ${e("roles")}Choisissez votre rôle\n` +
        `Chaque participant clique sur **Acheteur** ou **Vendeur**.\n\n` +
        `${e("buyer")}**Acheteur** — ${buyerLabel}\n` +
        `${e("seller")}**Vendeur** — ${sellerLabel}\n\n` +
        `${e("lock")}Anonymat avis / logs : \`/anonyme\``
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

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Confirmez les rôles\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("warning")}Vérifiez bien avant de valider.\n` +
        `${e("clock")}**${confirmCount}/2** confirmations`
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

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Rôles validés\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("next")}Génération de l'adresse de paiement…`
    )
  );

  return container;
}

function buildPaymentContainer(deal) {
  const container = new ContainerBuilder();

  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const address = deal.pay_address || "*adresse en cours de génération*";
  const status = statusLabel(deal.payment_status || "waiting");
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("payment")}Paiement escrow\n` +
        `${e("buyer")}<@${deal.buyer_id}> envoie **exactement** le montant ci-dessous.\n\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        `${e("money")}**Prix** — ${deal.price}${deal.currency}\n` +
        `${e("wallet")}**Adresse** — \`${address}\`\n` +
        `${e("clock")}**Statut** — ${status}\n\n` +
        `${e("warning")}Envoie uniquement du **${crypto}** à cette adresse.\n` +
        `${e("warning")}Si le montant n'est **pas exact**, **aucun remboursement** ne sera effectué.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
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

function buildPaymentSetupErrorContainer(deal, errorMessage) {
  const container = new ContainerBuilder();

  const isMin =
    /montant trop|too small|minimum|frais réseau|DUST|solde trop bas/i.test(
      String(errorMessage || "")
    );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Adresse indisponible\n` +
        `\`${errorMessage || "erreur inconnue"}\`\n\n` +
        (isMin
          ? `${e("info")}Montant trop bas pour les frais réseau Litecoin — augmente un peu le prix.`
          : `${e("next")}Réessaie : une nouvelle adresse sera générée.`)
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

/** Après un montant incorrect — nouvelle adresse, sans détail interne. */
function buildPaymentRetryContainer(deal) {
  const container = new ContainerBuilder();
  const amount = formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const address = deal.pay_address || "*adresse en cours*";
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("warning")}Montant incorrect\n` +
        `Le montant reçu ne correspond pas au montant exact demandé.\n` +
        `${e("warning")}**Aucun remboursement** ne sera effectué.\n\n` +
        `${e("buyer")}<@${deal.buyer_id}> — renvoie **exactement** :\n\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        `${e("wallet")}**Adresse** — \`${address}\`\n\n` +
        `${e("warning")}Envoie uniquement du **${crypto}** à cette adresse.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
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

function buildPaymentFailedContainer(deal, reason) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Paiement non finalisé\n` +
        `Statut : **${reason}**\n\n` +
        `${e("next")}Génère une nouvelle adresse, ou contacte le staff si des fonds ont déjà été envoyés.`
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

  const walletLine = deal.seller_wallet
    ? `${e("wallet")}**Adresse vendeur** — \`${deal.seller_wallet}\``
    : `${e("warning")}**Adresse vendeur** — à renseigner (**vendeur uniquement**)`;

  const payoutErrorLine = deal.payout_error
    ? `\n\n${e("error")}**Dernier payout échoué** — \`${deal.payout_error}\``
    : "";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Paiement confirmé\n` +
        `${e("shield")}Fonds reçus et sécurisés en **escrow**.\n\n` +
        `${e("seller")}<@${deal.seller_id}> — livre le produit.\n` +
        `${e("buyer")}<@${deal.buyer_id}> — confirme uniquement après réception.\n\n` +
        `${walletLine}${payoutErrorLine}\n\n` +
        `${e("lock")}Anonymat : \`/anonyme\``
    )
  );

  const walletButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_seller_wallet:${deal.deal_code}`)
      .setLabel(deal.seller_wallet ? "Modifier adresse (vendeur)" : "Adresse vendeur")
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

  const wallet = deal.seller_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  let body;
  if (deal.payout_error) {
    body =
      `${e("error")}Échec du payout : \`${deal.payout_error}\`\n` +
      `${e("staff")}Libération manuelle possible vers \`${wallet}\`.`;
  } else {
    body =
      `${e("success")}Payout diffusé sur Litecoin.\n\n` +
      `${e("wallet")}**Adresse** — \`${wallet}\`\n` +
      `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
      `${e("clock")}**Statut** — ${statusLabel(deal.payout_status || "processing")}\n` +
      (txBlock ? `${txBlock}\n` : "") +
      `\n${e("clock")}Confirmation blockchain…`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${e("release")}Payout en cours\n${body}`)
  );

  return container;
}

function buildPayoutConfirmedContainer(deal) {
  const container = new ContainerBuilder();

  const wallet = deal.seller_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Paiement envoyé\n` +
        `${e("release")}Fonds **confirmés** sur la blockchain.\n\n` +
        `${e("wallet")}**Adresse** — \`${wallet}\`\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        (txBlock ? `${txBlock}\n\n` : "\n") +
        `${e("next")}L'acheteur laisse un avis pour clôturer.`
    )
  );

  return container;
}

function buildReviewRequestContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Ton avis\n` +
        `${e("buyer")}<@${deal.buyer_id}> — laisse une note et un avis.\n\n` +
        `${e("lock")}Anonymat : \`/anonyme\`\n` +
        `${e("clock")}Le salon se ferme après l'avis.`
    )
  );

  const reviewButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_review:${deal.deal_code}`)
      .setLabel("Laisser un avis")
      .setStyle(ButtonStyle.Primary),
    "confirm"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(reviewButton));
  return container;
}

function buildPublicReviewContainer(deal, { botId } = {}) {
  const container = new ContainerBuilder();
  const stars =
    deal.review_rating != null
      ? `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - Number(deal.review_rating))}`
      : "—";
  const authorLine = `${e("users")}**Auteur** — ${formatAuthor(deal.buyer_id, {
    anonymous: Boolean(deal.review_anonymous),
  })}`;
  const botMention = botId ? `<@${botId}>` : "le bot";
  const when = discordTimestamp(deal.review_at || deal.completed_at || new Date().toISOString());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("confirm")}Nouvel avis`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${authorLine}\n` +
        `${e("escrow")}Avis pour ${botMention}\n` +
        `${e("ltc")}${formatCryptoAmountLine(deal)}\n` +
        `${e("confirm")}**Rating** — ${stars}\n\n` +
        `**Note**\n${deal.review_text || "*Aucun texte*"}\n\n` +
        `${e("clock")}${when}`
    )
  );
  return container;
}

function buildReviewPostedContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Avis enregistré\n` +
        `${e("confirm")}Merci — le deal est clôturé.\n` +
        `${e("close")}Fermeture du salon…`
    )
  );
  return container;
}

function buildDisputeContainer(deal, openedBy) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("dispute")}Litige ouvert\n` +
        `Ouvert par <@${openedBy}>.\n\n` +
        `**Motif**\n${deal.dispute_reason || "*non précisé*"}\n\n` +
        `${e("staff")}Actions staff :\n` +
        `• **Libérer vendeur**\n` +
        `• **Rembourser acheteur**\n` +
        `• **Clôturer** sans transfert`
    )
  );

  const releaseButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_release:${deal.deal_code}`)
      .setLabel("Libérer vendeur")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!deal.seller_wallet),
    "release"
  );

  const refundButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_refund:${deal.deal_code}`)
      .setLabel("Rembourser acheteur")
      .setStyle(ButtonStyle.Primary),
    "money"
  );

  const resolveButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_resolve:${deal.deal_code}`)
      .setLabel("Clôturer sans payout")
      .setStyle(ButtonStyle.Secondary),
    "staff"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(releaseButton, refundButton, resolveButton)
  );
  return container;
}

/** Remboursement diffusé — en attente de confirmation blockchain. */
function buildRefundPendingContainer(deal) {
  const container = new ContainerBuilder();
  const wallet = deal.buyer_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("money")}Remboursement en cours\n` +
        `${e("success")}Remboursement acheteur diffusé sur Litecoin.\n\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("wallet")}**Adresse** — \`${wallet}\`\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        `${e("clock")}**Statut** — ${statusLabel(deal.payout_status || "processing")}\n` +
        (txBlock ? `${txBlock}\n` : "") +
        `\n${e("clock")}Confirmation blockchain…`
    )
  );

  return container;
}

function buildCloseTicketContainer(deal, byUserId, { reason = "cancelled" } = {}) {
  const container = new ContainerBuilder();

  let body;
  if (reason === "refunded") {
    body =
      `## ${e("success")}Remboursement confirmé\n` +
      `${e("money")}Les fonds ont été renvoyés à l'acheteur.\n` +
      (byUserId ? `Traité par <@${byUserId}>.\n\n` : "\n") +
      `${e("staff")}Un membre du staff peut fermer ce salon.`;
  } else {
    body =
      `## ${e("cancel")}Deal annulé\n` +
      (byUserId ? `Annulé par <@${byUserId}>.\n\n` : "\n") +
      `${e("staff")}Un membre du staff doit fermer ce salon.`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

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
  buildPaymentRetryContainer,
  buildPaymentFailedContainer,
  buildFundsHeldContainer,
  buildReleasedContainer,
  buildPayoutConfirmedContainer,
  buildReviewRequestContainer,
  buildPublicReviewContainer,
  buildReviewPostedContainer,
  buildDisputeContainer,
  buildRefundPendingContainer,
  buildCloseTicketContainer,
  formatTxBlock,
};
