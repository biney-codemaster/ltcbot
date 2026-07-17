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
  buildPaymentSetupErrorContainer,
  buildFundsHeldContainer,
  buildReleasedContainer,
  buildDisputeContainer,
  buildCloseTicketContainer,
} = require("../utils/dealContainer");
const {
  createLtcPayment,
  payoutToSeller,
  isValidLtcAddress,
  getPaymentStatus,
} = require("../utils/oxapay");
const { refreshDealPayment, updateFundsHeldMessage } = require("../utils/paymentPoller");
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
  return interaction.reply({ content: `${e("error")}${message}`, flags: MessageFlags.Ephemeral });
}

async function createAndSendPayment(channel, deal) {
  const payment = await createLtcPayment(deal);
  const payAmount = payment.pay_amount != null ? Number(payment.pay_amount) : deal.pay_amount;

  db.prepare(
    `UPDATE deals
     SET payment_id = @payment_id,
         pay_address = @pay_address,
         pay_amount = @pay_amount,
         payment_status = @payment_status,
         status = 'awaiting_payment',
         payout_error = NULL,
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
  const paymentMessage = await channel.send({
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

async function runSellerPayout(deal) {
  let paymentDetails = null;
  if (deal.payment_id) {
    try {
      paymentDetails = await getPaymentStatus(deal.payment_id);
    } catch (err) {
      console.warn("Impossible de relire le paiement avant payout:", err.message);
    }
  }
  return payoutToSeller(deal, paymentDetails);
}

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
    await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });

    await interaction.channel.send({
      components: [buildFinalRecapContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      await createAndSendPayment(interaction.channel, updatedDeal);
    } catch (err) {
      console.error("Création paiement OxaPay:", err.message);
      db.prepare(
        `UPDATE deals
         SET status = 'payment_failed', updated_at = datetime('now')
         WHERE deal_code = ?`
      ).run(dealCode);
      const failedDeal = getDealByCode(dealCode);
      await interaction.channel.send({
        components: [buildPaymentSetupErrorContainer(failedDeal, err.message)],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    return;
  }

  await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });
}

async function handleWrongRolesButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (deal.status !== "pending_confirmation") {
    return deny(interaction, "Les rôles ne peuvent plus être modifiés.");
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

async function handleCancelButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  // Annulation libre uniquement avant qu'une invoice existe
  if (deal.status !== "pending_confirmation" || deal.payment_id) {
    return deny(
      interaction,
      "Annulation impossible après génération du paiement. Ouvre un litige ou contacte le staff."
    );
  }

  db.prepare(`UPDATE deals SET status = 'cancelled' WHERE deal_code = ?`).run(dealCode);
  const updatedDeal = getDealByCode(dealCode);

  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });
  await interaction.channel.send({
    components: [buildCloseTicketContainer(updatedDeal, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function handleCheckPaymentButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (!deal.payment_id) {
    return deny(interaction, "Aucun paiement n'a encore été généré.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const updated = await refreshDealPayment(deal);
    if (updated.status === "funds_held") {
      return interaction.editReply({
        content: `${e("success")}Paiement reçu. Les fonds sont maintenant sécurisés en escrow.`,
      });
    }
    if (updated.status === "payment_failed") {
      return interaction.editReply({
        content: `${e("error")}Paiement échoué/expiré. Tu peux régénérer une adresse.`,
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

async function handleRegenPaymentButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "Ce deal ne te concerne pas.");
  }
  if (!["payment_failed", "awaiting_payment"].includes(deal.status) && deal.payment_id) {
    // awaiting without usable payment also ok via payment_failed
  }
  if (!["payment_failed", "awaiting_payment"].includes(deal.status)) {
    return deny(interaction, "Impossible de régénérer une adresse à ce stade.");
  }

  await interaction.deferUpdate();

  try {
    // Invalide l'ancienne invoice côté bot
    db.prepare(
      `UPDATE deals
       SET payment_id = NULL,
           pay_address = NULL,
           payment_status = NULL,
           payment_message_id = NULL,
           status = 'awaiting_payment',
           updated_at = datetime('now')
       WHERE deal_code = ?`
    ).run(dealCode);

    const fresh = getDealByCode(dealCode);
    await interaction.message.edit({ components: [] }).catch(() => {});
    await createAndSendPayment(interaction.channel, fresh);
  } catch (err) {
    console.error("Régénération paiement:", err.message);
    const failedDeal = getDealByCode(dealCode);
    db.prepare(
      `UPDATE deals SET status = 'payment_failed', updated_at = datetime('now') WHERE deal_code = ?`
    ).run(dealCode);
    await interaction.channel.send({
      components: [buildPaymentSetupErrorContainer(failedDeal, err.message)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

async function handleReleaseButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (deal.status !== "funds_held" && !(deal.status === "disputed" && isStaff(interaction.member))) {
    // release from funds_held only here; staff dispute uses staff_release
    if (deal.status !== "funds_held") {
      return deny(interaction, "Les fonds ne sont pas encore en escrow.");
    }
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await runSellerPayout(deal);
    const payoutStatus = result.status || "processing";

    db.prepare(
      `UPDATE deals
       SET status = 'released',
           payout_id = @payout_id,
           payout_status = @payout_status,
           payout_error = NULL,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      payout_id: result.payoutId,
      payout_status: payoutStatus,
      deal_code: dealCode,
    });

    const updatedDeal = getDealByCode(dealCode);

    if (deal.funds_held_message_id) {
      try {
        const msg = await interaction.channel.messages.fetch(deal.funds_held_message_id);
        await msg.edit({ components: [] });
      } catch {
        // ignore
      }
    }

    await interaction.channel.send({
      components: [buildReleasedContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });

    return interaction.editReply({
      content: `${e("success")}Payout initié vers le vendeur.`,
    });
  } catch (err) {
    console.error("Payout vendeur:", err.message);
    db.prepare(
      `UPDATE deals
       SET payout_error = @payout_error,
           payout_status = 'failed',
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({ payout_error: err.message, deal_code: dealCode });

    const updatedDeal = getDealByCode(dealCode);
    await updateFundsHeldMessage(updatedDeal);

    return interaction.editReply({
      content:
        `${e("error")}Payout échoué : \`${err.message}\`\n` +
        `Le deal reste en **fonds sécurisés** — tu peux réessayer.`,
    });
  }
}

async function handleSellerWalletButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!["funds_held", "disputed"].includes(deal.status)) {
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
    flags: MessageFlags.Ephemeral,
  });

  const updated = await updateFundsHeldMessage(updatedDeal);
  if (!updated && updatedDeal.status === "disputed") {
    // rien
  }
}

async function handleDisputeButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (!["funds_held", "awaiting_payment", "payment_failed"].includes(deal.status)) {
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

async function handleStaffReleaseButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Réservé au staff.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (deal.status !== "disputed" && deal.status !== "funds_held") {
    return deny(interaction, "Libération staff impossible à ce stade.");
  }
  if (!deal.seller_wallet) {
    return deny(interaction, "Le vendeur doit d'abord avoir une adresse LTC.");
  }

  // Réutilise la logique release
  db.prepare(
    `UPDATE deals SET status = 'funds_held', mediator_id = @mediator_id WHERE deal_code = @deal_code`
  ).run({ mediator_id: interaction.user.id, deal_code: dealCode });

  return handleReleaseButton(interaction, dealCode);
}

async function handleStaffResolveButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Réservé au staff.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal introuvable.");
  if (deal.status !== "disputed") {
    return deny(interaction, "Ce deal n'est pas en litige.");
  }

  db.prepare(
    `UPDATE deals
     SET status = 'cancelled',
         mediator_id = @mediator_id,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ mediator_id: interaction.user.id, deal_code: dealCode });

  await interaction.update({ components: [] });
  await interaction.channel.send({
    content:
      `${e("staff")}Litige #${dealCode} clôturé par <@${interaction.user.id}>.\n` +
      `${e("warning")}Aucun payout auto n'a été déclenché — gérez un éventuel remboursement depuis OxaPay.`,
  });
  await interaction.channel.send({
    components: [buildCloseTicketContainer(getDealByCode(dealCode), interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });
}

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
  handleRegenPaymentButton,
  handleReleaseButton,
  handleSellerWalletButton,
  handleSellerWalletModal,
  handleDisputeButton,
  handleDisputeModal,
  handleStaffReleaseButton,
  handleStaffResolveButton,
  handleCloseButton,
  getDealByCode,
};
