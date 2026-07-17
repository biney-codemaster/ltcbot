const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
} = require("discord.js");
const db = require("../database");
const config = require("../config");
const {
  buildRoleSelectionContainer,
  buildConfirmationContainer,
  buildFinalRecapContainer,
  buildPaymentContainer,
  buildFundsHeldContainer,
  buildReleasedContainer,
  buildDisputeContainer,
  buildCloseTicketContainer,
} = require("../utils/dealContainer");
const { createLtcPayment, payoutToSeller, isValidLtcAddress } = require("../utils/nowpayments");
const { refreshDealPayment } = require("../utils/paymentPoller");
const { formatLtcAmount } = require("../utils/ltcPrice");

const { e } = config;

function getDealByCode(dealCode) {
  return db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(dealCode);
}

function isParticipant(deal, userId) {
  return userId === deal.initiator_id || userId === deal.partner_id;
}

function isStaff(member) {
  return config.staffRoleId && member.roles.cache.has(config.staffRoleId);
}

function deny(interaction, message) {
  return interaction.reply({ content: `${e("error")}${message}`, ephemeral: true });
}

async function createAndSendPayment(interaction, deal) {
  const payment = await createLtcPayment(deal);
  const payAmount = payment.pay_amount != null ? Number(payment.pay_amount) : deal.pay_amount;

  db.prepare(
    `UPDATE deals
     SET payment_id = @payment_id,
         pay_address = @pay_address,
         pay_amount = @pay_amount,
         payment_status = @payment_status,
         status = 'awaiting_payment',
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_id: String(payment.payment_id),
    pay_address: payment.pay_address,
    pay_amount: payAmount,
    payment_status: payment.payment_status || "waiting",
    deal_code: deal.deal_code,
  });

  const updatedDeal = getDealByCode(deal.deal_code);
  const paymentMessage = await interaction.channel.send({
    components: [buildPaymentContainer(updatedDeal)],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(
    `UPDATE deals SET payment_message_id = @payment_message_id WHERE deal_code = @deal_code`
  ).run({
    payment_message_id: paymentMessage.id,
    deal_code: deal.deal_code,
  });

  return getDealByCode(deal.deal_code);
}

/**
 * Clic sur "Acheteur" ou "Vendeur".
 */
async function handleRoleButton(interaction, role, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (deal.status !== "pending_confirmation") {
    return deny(interaction, "Les rôles ne peuvent plus être modifiés.");
  }

  const userId = interaction.user.id;
  const updates = {};

  if (role === "BUYER") {
    if (deal.seller_id === userId) updates.seller_id = null;
    updates.buyer_id = userId;
  } else {
    if (deal.buyer_id === userId) updates.buyer_id = null;
    updates.seller_id = userId;
  }

  const setClause = Object.keys(updates).map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE deals SET ${setClause} WHERE deal_code = @deal_code`).run({
    ...updates,
    deal_code: dealCode,
  });

  const updatedDeal = getDealByCode(dealCode);
  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });

  if (updatedDeal.buyer_id && updatedDeal.seller_id && !updatedDeal.confirm_message_id) {
    const confirmMessage = await interaction.channel.send({
      components: [buildConfirmationContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });
    db.prepare(`UPDATE deals SET confirm_message_id = @id WHERE deal_code = @deal_code`).run({
      id: confirmMessage.id,
      deal_code: dealCode,
    });
  }
}

/**
 * Clic sur "Confirmer".
 */
async function handleConfirmButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }

  const isInitiator = interaction.user.id === deal.initiator_id;
  const field = isInitiator ? "initiator_confirmed" : "partner_confirmed";

  if (deal[field]) {
    return deny(interaction, "Tu as déjà confirmé.");
  }

  db.prepare(`UPDATE deals SET ${field} = 1 WHERE deal_code = ?`).run(dealCode);
  let updatedDeal = getDealByCode(dealCode);

  if (updatedDeal.initiator_confirmed && updatedDeal.partner_confirmed) {
    db.prepare(`UPDATE deals SET status = 'awaiting_payment' WHERE deal_code = ?`).run(dealCode);
    updatedDeal = getDealByCode(dealCode);

    await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });

    await interaction.channel.send({
      components: [buildFinalRecapContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      await createAndSendPayment(interaction, updatedDeal);
    } catch (err) {
      console.error("Création paiement NOWPayments:", err.message);
      await interaction.channel.send({
        content:
          `${e("error")}Impossible de générer l'adresse de paiement pour le moment.\n` +
          `Erreur : \`${err.message}\`\n` +
          `${e("staff")}Vérifiez la clé NOWPAYMENTS_API_KEY puis réessayez.`,
      });
    }
    return;
  }

  await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });
}

/**
 * Clic sur "Rôles incorrects": réinitialise et renvoie un NOUVEAU container de sélection.
 */
async function handleWrongRolesButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }

  db.prepare(`
    UPDATE deals
    SET buyer_id = NULL, seller_id = NULL, initiator_confirmed = 0, partner_confirmed = 0, confirm_message_id = NULL
    WHERE deal_code = ?
  `).run(dealCode);

  const updatedDeal = getDealByCode(dealCode);

  await interaction.update({ components: [] });

  const newRoleMessage = await interaction.channel.send({
    components: [buildRoleSelectionContainer(updatedDeal)],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(`UPDATE deals SET message_id = @message_id WHERE deal_code = @deal_code`).run({
    message_id: newRoleMessage.id,
    deal_code: dealCode,
  });
}

/**
 * Clic sur "Annuler" (container étape 1): marque le deal annulé, envoie le container de fermeture.
 */
async function handleCancelButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (!["pending_confirmation", "awaiting_payment"].includes(deal.status)) {
    return deny(interaction, "Ce deal ne peut plus être annulé à ce stade.");
  }

  db.prepare(`UPDATE deals SET status = 'cancelled' WHERE deal_code = ?`).run(dealCode);
  const updatedDeal = getDealByCode(dealCode);

  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });

  await interaction.channel.send({
    components: [buildCloseTicketContainer(updatedDeal, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/**
 * Vérifie manuellement le statut du paiement NOWPayments.
 */
async function handleCheckPaymentButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (!deal.payment_id) {
    return deny(interaction, "Aucun paiement n'a encore été généré.");
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const updated = await refreshDealPayment(deal);
    if (updated.status === "funds_held") {
      return interaction.editReply({
        content: `${e("success")}Paiement reçu. Les fonds sont maintenant sécurisés en escrow.`,
      });
    }

    const amount = formatLtcAmount(Number(updated.pay_amount)) || "—";
    return interaction.editReply({
      content:
        `${e("clock")}Statut actuel : **${updated.payment_status || "waiting"}**\n` +
        `${e("ltc")}Montant attendu : \`${amount} ${updated.crypto || "LTC"}\``,
    });
  } catch (err) {
    console.error("Vérification paiement:", err.message);
    return interaction.editReply({
      content: `${e("error")}Impossible de vérifier le paiement : \`${err.message}\``,
    });
  }
}

/**
 * Acheteur confirme la réception → payout Custody vers le vendeur.
 */
async function handleReleaseButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (deal.status !== "funds_held") {
    return deny(interaction, "Les fonds ne sont pas encore en escrow.");
  }
  if (interaction.user.id !== deal.buyer_id && !isStaff(interaction.member)) {
    return deny(interaction, "Seul l'acheteur (ou le staff) peut libérer les fonds.");
  }
  if (!deal.seller_wallet) {
    return deny(
      interaction,
      "Le vendeur doit d'abord renseigner son adresse LTC (bouton Adresse de retrait)."
    );
  }

  await interaction.deferUpdate();

  let payoutId = null;
  let payoutStatus = null;
  let payoutError = null;

  try {
    const result = await payoutToSeller(deal);
    payoutId = result.payoutId;
    payoutStatus = result.status;
    if (result.warning) {
      payoutStatus = "awaiting_2fa";
    }
  } catch (err) {
    console.error("Payout vendeur:", err.message);
    payoutError = err.message;
    payoutStatus = "failed";
  }

  db.prepare(
    `UPDATE deals
     SET status = 'released',
         payout_id = @payout_id,
         payout_status = @payout_status,
         payout_error = @payout_error,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payout_id: payoutId,
    payout_status: payoutStatus,
    payout_error: payoutError,
    deal_code: dealCode,
  });

  const updatedDeal = getDealByCode(dealCode);

  await interaction.editReply({ components: [] });
  await interaction.channel.send({
    components: [buildReleasedContainer(updatedDeal)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/**
 * Vendeur (ou staff) ouvre le modal d'adresse LTC.
 */
async function handleSellerWalletButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (deal.status !== "funds_held") {
    return deny(interaction, "L'adresse ne peut être définie qu'une fois les fonds sécurisés.");
  }
  if (interaction.user.id !== deal.seller_id && !isStaff(interaction.member)) {
    return deny(interaction, "Seul le vendeur (ou le staff) peut définir l'adresse de retrait.");
  }

  const modal = new ModalBuilder()
    .setCustomId(`deal_seller_wallet_modal:${dealCode}`)
    .setTitle("Adresse LTC de retrait");

  const walletInput = new TextInputBuilder()
    .setCustomId("seller_wallet")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder("ltc1... ou L...");

  if (deal.seller_wallet) {
    walletInput.setValue(deal.seller_wallet);
  }

  const walletLabel = new LabelBuilder()
    .setLabel("Adresse Litecoin du vendeur")
    .setTextInputComponent(walletInput);

  modal.addLabelComponents(walletLabel);
  await interaction.showModal(modal);
}

/**
 * Enregistre l'adresse LTC du vendeur.
 */
async function handleSellerWalletModal(interaction) {
  const dealCode = interaction.customId.split(":")[1];
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (interaction.user.id !== deal.seller_id && !isStaff(interaction.member)) {
    return deny(interaction, "Seul le vendeur (ou le staff) peut définir l'adresse de retrait.");
  }

  const wallet = interaction.fields.getTextInputValue("seller_wallet").trim();
  if (!isValidLtcAddress(wallet)) {
    return deny(
      interaction,
      "Adresse LTC invalide. Utilise une adresse Litecoin (L… / M… / ltc1…)."
    );
  }

  db.prepare(
    `UPDATE deals
     SET seller_wallet = @seller_wallet, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ seller_wallet: wallet, deal_code: dealCode });

  const updatedDeal = getDealByCode(dealCode);

  await interaction.reply({
    content: `${e("success")}Adresse de retrait enregistrée : \`${wallet}\``,
    ephemeral: true,
  });

  // Met à jour le message funds_held si possible (message de l'interaction précédente non dispo)
  try {
    const messages = await interaction.channel.messages.fetch({ limit: 15 });
    const fundsMsg = messages.find(
      (m) =>
        m.author.id === interaction.client.user.id &&
        m.components?.length &&
        JSON.stringify(m.components).includes(`deal_release:${dealCode}`)
    );
    if (fundsMsg) {
      await fundsMsg.edit({
        components: [buildFundsHeldContainer(updatedDeal)],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  } catch (err) {
    console.error("Maj container funds_held:", err.message);
  }
}

/**
 * Ouvre le modal de litige.
 */
async function handleDisputeButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!["funds_held", "awaiting_payment"].includes(deal.status)) {
    return deny(interaction, "Aucun litige ne peut être ouvert à ce stade.");
  }
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }

  const modal = new ModalBuilder()
    .setCustomId(`deal_dispute_modal:${dealCode}`)
    .setTitle("Ouvrir un litige");

  const reasonLabel = new LabelBuilder()
    .setLabel("Motif du litige")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("dispute_reason")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder("Décrivez le problème clairement...")
    );

  modal.addLabelComponents(reasonLabel);
  await interaction.showModal(modal);
}

/**
 * Soumission du modal litige.
 */
async function handleDisputeModal(interaction) {
  const dealCode = interaction.customId.split(":")[1];
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }

  const reason = interaction.fields.getTextInputValue("dispute_reason").trim();
  if (!reason) return deny(interaction, "Le motif du litige est obligatoire.");

  db.prepare(
    `UPDATE deals
     SET status = 'disputed',
         dispute_reason = @dispute_reason,
         mediator_id = NULL,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ dispute_reason: reason, deal_code: dealCode });

  const updatedDeal = getDealByCode(dealCode);

  await interaction.reply({
    components: [buildDisputeContainer(updatedDeal, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/**
 * Clic sur "Fermer le salon": réservé au staff.
 */
async function handleCloseButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");

  if (!isStaff(interaction.member)) {
    return deny(interaction, "Seul le staff peut fermer ce salon.");
  }

  await interaction.reply({
    content: `${e("close")}Salon fermé par <@${interaction.user.id}>. Suppression dans 5 secondes...`,
  });
  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 5000);
}

module.exports = {
  handleRoleButton,
  handleConfirmButton,
  handleWrongRolesButton,
  handleCancelButton,
  handleCheckPaymentButton,
  handleReleaseButton,
  handleSellerWalletButton,
  handleSellerWalletModal,
  handleDisputeButton,
  handleDisputeModal,
  handleCloseButton,
  getDealByCode,
};
