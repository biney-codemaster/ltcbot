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
const { formatLtcAmount, formatLtcRate } = require("./ltcPrice");
const { statusLabel } = require("./ltcWallet");
const { formatAuthor } = require("./userPrefs");

const { e, emojis } = config;

function applyEmoji(button, key) {
  if (emojis[key]) button.setEmoji(emojis[key]);
  return button;
}

function impliedRate(deal) {
  const price = Number(deal.price);
  const amount = Number(deal.pay_amount);
  if (!Number.isFinite(price) || !Number.isFinite(amount) || amount <= 0) return null;
  return price / amount;
}

function formatCryptoPrice(deal) {
  const crypto = deal.crypto || "LTC";
  const amount = formatLtcAmount(Number(deal.pay_amount));
  if (!amount) return `${crypto} · cours indisponible`;
  const rateTxt = formatLtcRate(impliedRate(deal), deal.currency);
  return rateTxt ? `≈ ${amount} ${crypto} (${rateTxt})` : `≈ ${amount} ${crypto}`;
}

function dealTitle(deal) {
  return `# ${e("deal")}Deal #${deal.deal_code}`;
}

function dealOverview(deal, { preferRoles = false } = {}) {
  const people =
    preferRoles && deal.buyer_id && deal.seller_id
      ? `## ${e("roles")}Rôles\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n`
      : `## ${e("users")}Participants\n` +
        `<@${deal.initiator_id}> ↔ <@${deal.partner_id}>\n\n`;

  return (
    people +
    `## ${e("product")}Détails\n` +
    `**Produit** — ${deal.product}\n` +
    `**Prix** — ${deal.price}${deal.currency}\n` +
    `**${deal.crypto || "LTC"}** — ${formatCryptoPrice(deal)}`
  );
}

function addStandardHeader(container, deal, opts = {}) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(dealOverview(deal, opts))
  );
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
      `## ${e("roles")}Choisissez votre rôle\n` +
        `Chaque participant clique sur **Acheteur** ou **Vendeur**.\n\n` +
        `${e("buyer")}**Acheteur** — ${buyerLabel}\n` +
        `${e("seller")}**Vendeur** — ${sellerLabel}\n\n` +
        `${e("lock")}Anonymat dans les avis / logs : \`/anonyme\``
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
      `## ${e("confirm")}Confirmez les rôles\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("warning")}Vérifiez bien avant de valider — c'est définitif pour la suite.\n` +
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
  addStandardHeader(container, deal);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Rôles validés\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n\n` +
        `${e("shield")}Les deux parties sont d'accord.\n` +
        `${e("next")}Génération de l'adresse de paiement **${deal.crypto || "LTC"}**…`
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
  const rateTxt = formatLtcRate(impliedRate(deal), deal.currency);
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("payment")}Paiement escrow\n` +
        `${e("buyer")}<@${deal.buyer_id}> envoie le montant exact ci-dessous.\n\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        (rateTxt ? `${e("money")}**Cours** — ${rateTxt}\n` : "") +
        `${e("money")}**Prix** — ${deal.price}${deal.currency}\n` +
        `${e("wallet")}**Adresse** — \`${address}\`\n` +
        `${e("clock")}**Statut** — ${status}\n\n` +
        `${e("warning")}Envoie uniquement du **${crypto}** à cette adresse.`
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

function buildPaymentFailedContainer(deal, reason) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal);

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
  addStandardHeader(container, deal, { preferRoles: true });

  const walletLine = deal.seller_wallet
    ? `${e("wallet")}**Adresse vendeur** — \`${deal.seller_wallet}\``
    : `${e("warning")}**Adresse vendeur** — à renseigner (vendeur uniquement)`;

  const payoutErrorLine = deal.payout_error
    ? `\n\n${e("error")}**Dernier payout échoué** — \`${deal.payout_error}\`\nTu peux réessayer la libération.`
    : "";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("shield")}Fonds sécurisés\n` +
        `${e("success")}Paiement reçu — les LTC sont en **escrow**.\n\n` +
        `${e("seller")}<@${deal.seller_id}> — livre le produit.\n` +
        `${e("buyer")}<@${deal.buyer_id}> — confirme uniquement après réception.\n\n` +
        `${walletLine}${payoutErrorLine}\n\n` +
        `${e("lock")}Anonymat avis / logs publics : commande \`/anonyme\``
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
  addStandardHeader(container, deal, { preferRoles: true });

  const payoutStatus = deal.payout_status || "unknown";
  const wallet = deal.seller_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const txid = deal.payout_id || null;
  const explorerUrl = txid ? `https://litecoinspace.org/tx/${txid}` : null;
  const crypto = deal.crypto || "LTC";

  let payoutText;
  if (deal.payout_error) {
    payoutText =
      `${e("error")}Échec du payout : \`${deal.payout_error}\`\n` +
      `${e("staff")}Libération manuelle possible vers \`${wallet}\`.`;
  } else {
    payoutText =
      `${e("success")}Payout diffusé sur Litecoin.\n\n` +
      `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n` +
      `${e("wallet")}**Adresse** — \`${wallet}\`\n` +
      `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
      `${e("clock")}**Statut** — ${statusLabel(payoutStatus)}\n` +
      (txid ? `${e("info")}**TXID** — \`${txid}\`\n` : "") +
      (explorerUrl ? `${e("next")}[Voir la transaction](${explorerUrl})` : "");
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("release")}Payout en cours\n` +
        `${e("success")}L'acheteur a confirmé la réception.\n\n` +
        `${payoutText}\n\n` +
        `${e("clock")}Confirmation blockchain en cours…`
    )
  );

  return container;
}

function buildPayoutConfirmedContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal, { preferRoles: true });

  const wallet = deal.seller_wallet || "—";
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const txid = deal.payout_id || "—";
  const crypto = deal.crypto || "LTC";
  const explorerUrl =
    deal.payout_id && /^[a-f0-9]{64}$/i.test(deal.payout_id)
      ? `https://litecoinspace.org/tx/${deal.payout_id}`
      : null;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Paiement envoyé\n` +
        `${e("release")}Fonds **confirmés** sur la blockchain.\n\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n` +
        `${e("wallet")}**Adresse** — \`${wallet}\`\n` +
        `${e("ltc")}**Montant** — \`${amount} ${crypto}\`\n` +
        `${e("info")}**TXID** — \`${txid}\`\n` +
        (explorerUrl ? `${e("next")}[Voir la transaction](${explorerUrl})\n\n` : "\n") +
        `${e("next")}Dernière étape : l'acheteur laisse un avis pour clôturer.`
    )
  );

  return container;
}

function buildReviewRequestContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal, { preferRoles: true });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Ton avis\n` +
        `${e("buyer")}<@${deal.buyer_id}> — le payout vendeur est confirmé.\n\n` +
        `Laisse une **note** et un court avis sur le bot escrow.\n` +
        `${e("lock")}Pour apparaître anonyme dans les avis / logs : \`/anonyme\`\n\n` +
        `${e("clock")}Le salon se ferme après l'avis (transcript en MP).`
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

function buildPublicReviewContainer(deal) {
  const container = new ContainerBuilder();
  const stars =
    deal.review_rating != null
      ? `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - Number(deal.review_rating))}`
      : "—";
  const authorLine = `${e("users")}**Auteur** — ${formatAuthor(deal.buyer_id, {
    anonymous: Boolean(deal.review_anonymous),
  })}`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("confirm")}Nouvel avis`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${authorLine}\n` +
        `${e("escrow")}Avis pour le **bot escrow**\n` +
        `${e("confirm")}**Note** — ${stars}\n\n` +
        `${deal.review_text || "*Aucun texte*"}`
    )
  );
  return container;
}

function buildReviewPostedContainer(deal) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal, { preferRoles: true });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Avis enregistré\n` +
        `${e("confirm")}Merci — le deal est clôturé.\n\n` +
        `${e("info")}Transcript HTML envoyé au staff et en MP aux deux parties.\n` +
        `${e("close")}Fermeture du salon…`
    )
  );
  return container;
}

function buildDisputeContainer(deal, openedBy) {
  const container = new ContainerBuilder();
  addStandardHeader(container, deal, { preferRoles: true });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("dispute")}Litige ouvert\n` +
        `Ouvert par <@${openedBy}>.\n\n` +
        `**Motif**\n${deal.dispute_reason || "*non précisé*"}\n\n` +
        `${e("staff")}Actions staff :\n` +
        `• **Libérer vendeur** — payout vers l'adresse vendeur\n` +
        `• **Rembourser acheteur** — renvoi des LTC\n` +
        `• **Clôturer** — ferme sans transfert auto`
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
        `${e("staff")}Un membre du staff doit fermer ce salon.`
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
  buildPayoutConfirmedContainer,
  buildReviewRequestContainer,
  buildPublicReviewContainer,
  buildReviewPostedContainer,
  buildDisputeContainer,
  buildCloseTicketContainer,
};
