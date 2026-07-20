const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  buildRefundPendingContainer,
  buildPublicReviewContainer,
  canUserCancel,
} = require("../utils/dealContainer");
const {
  createPayment,
  payoutToSeller,
  refundToBuyer,
  findBuyerRefundAddress,
  isValidAddress,
  getPaymentStatus,
  formatCryptoAmount,
  cryptoEmoji,
  addressPlaceholder,
  addressHint,
  networkName,
} = require("../utils/cryptoWallet");
const { refreshDealPayment, updateFundsHeldMessage } = require("../utils/paymentPoller");
const {
  logAdmin,
  dealCodeTag,
  formatTxidLine,
  formatBuyerSellerLines,
} = require("../utils/dealLogger");
const { finalizeDealAfterReview } = require("../utils/dealFinalize");
const { isUserAnonymous } = require("../utils/userPrefs");

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

function isBuyer(deal, userId) {
  return Boolean(deal.buyer_id) && userId === deal.buyer_id;
}

function isSeller(deal, userId) {
  return Boolean(deal.seller_id) && userId === deal.seller_id;
}

function deny(interaction, message) {
  return interaction.reply({ content: `${e("error")}${message}`, flags: MessageFlags.Ephemeral });
}

/** Acheteur (ou staff). */
function denyUnlessBuyer(interaction, deal) {
  if (isBuyer(deal, interaction.user.id) || isStaff(interaction.member)) return null;
  return deny(interaction, "Only the **customer** can use this button.");
}

/** Vendeur (ou staff). L'acheteur est TOUJOURS refusé pour l'adresse de retrait. */
function denyUnlessSeller(interaction, deal) {
  const uid = interaction.user.id;
  if (isBuyer(deal, uid) && !isSeller(deal, uid)) {
    return deny(
      interaction,
      "⛔ The **customer** cannot add or change the seller's address."
    );
  }
  if (isSeller(deal, uid) || isStaff(interaction.member)) return null;
  return deny(interaction, "Only the **seller** can use this button.");
}

/** Réservé strictement au vendeur (pas le staff à la place du vendeur pour l'adresse). */
function denyUnlessSellerOnly(interaction, deal) {
  const uid = interaction.user.id;
  if (isBuyer(deal, uid)) {
    return deny(
      interaction,
      "⛔ The **customer** cannot add or change the seller's address."
    );
  }
  if (!isSeller(deal, uid)) {
    return deny(
      interaction,
      "Only this deal's **seller** can set or change this address."
    );
  }
  return null;
}

async function createAndSendPayment(channel, deal) {
  const payment = await createPayment(deal);
  const payAmount = payment.pay_amount != null ? Number(payment.pay_amount) : deal.pay_amount;

  db.prepare(
    `UPDATE deals
     SET payment_id = @payment_id,
         pay_address = @pay_address,
         pay_amount = @pay_amount,
         expected_pay_amount = @expected_pay_amount,
         received_pay_amount = NULL,
         payment_status = @payment_status,
         wallet_index = @wallet_index,
         status = 'awaiting_payment',
         payout_error = NULL,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_id: String(payment.payment_id),
    pay_address: payment.pay_address,
    pay_amount: payAmount,
    expected_pay_amount: payAmount,
    payment_status: payment.payment_status || "waiting",
    wallet_index: payment.wallet_index != null ? Number(payment.wallet_index) : null,
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "This deal doesn't involve you.");
  }
  if (deal.status !== "pending_confirmation") {
    return deny(interaction, "Roles can no longer be changed.");
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "This deal doesn't involve you.");
  }

  const isInitiator = interaction.user.id === deal.initiator_id;
  const field = isInitiator ? "initiator_confirmed" : "partner_confirmed";

  if (deal[field]) {
    return deny(interaction, "You already confirmed.");
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
      const paidDeal = getDealByCode(dealCode);
      const coin = paidDeal.crypto || "LTC";
      await logAdmin(interaction.client, `Payment generated #${dealCodeTag(dealCode)}`, [
        `${e("payment")}${coin} address created`,
        `${e("wallet")}**Address** — \`${paidDeal.pay_address || "—"}\``,
        `${cryptoEmoji(coin)}**Amount** — \`${formatCryptoAmount(Number(paidDeal.pay_amount), coin) || "—"} ${coin}\``,
        ...formatBuyerSellerLines(paidDeal),
      ]);
    } catch (err) {
      console.error("Crypto wallet payment creation:", err.message);
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "This deal doesn't involve you.");
  }
  if (deal.status !== "pending_confirmation") {
    return deny(interaction, "Roles can no longer be changed.");
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (!isParticipant(deal, interaction.user.id)) {
    return deny(interaction, "This deal doesn't involve you.");
  }
  if (!canUserCancel(deal)) {
    return deny(
      interaction,
      "Cancellation isn't possible after roles are locked in. Click **Staff** if you need help."
    );
  }

  db.prepare(
    `UPDATE deals
     SET status = 'cancelled',
         cancel_initiator_confirmed = 0,
         cancel_partner_confirmed = 0,
         updated_at = datetime('now')
     WHERE deal_code = ?`
  ).run(dealCode);
  const updatedDeal = getDealByCode(dealCode);

  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });
  await interaction.channel.send({
    components: [buildCloseTicketContainer(updatedDeal, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });

  await logAdmin(interaction.client, `Deal cancelled #${dealCodeTag(dealCode)}`, [
    `${e("cancel")}Cancelled by <@${interaction.user.id}>`,
    `${e("product")}**Product** — ${updatedDeal.product}`,
    `${e("money")}**Price** — ${updatedDeal.price}${updatedDeal.currency}`,
    ...formatBuyerSellerLines(updatedDeal),
  ]);
}

async function handleCheckPaymentButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  const blocked = denyUnlessBuyer(interaction, deal);
  if (blocked) return blocked;
  if (!deal.payment_id) {
    return deny(interaction, "No payment has been generated yet.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const updated = await refreshDealPayment(deal);
    if (updated.status === "funds_held") {
      return interaction.editReply({
        content: `${e("success")}Payment received. Funds are now secured in escrow.`,
      });
    }
    if (updated.status === "payment_failed") {
      return interaction.editReply({
        content: `${e("error")}Payment failed/expired. You can regenerate an address.`,
      });
    }

    const coin = updated.crypto || "LTC";
    const amount = formatCryptoAmount(Number(updated.pay_amount), coin) || "—";
    return interaction.editReply({
      content:
        `${e("clock")}Current status: **${updated.payment_status || "waiting"}**\n` +
        `${cryptoEmoji(coin)}Expected amount: \`${amount} ${coin}\``,
    });
  } catch (err) {
    console.error("Vérification paiement:", err.message);
    return interaction.editReply({
      content: `${e("error")}Could not check payment: \`${err.message}\``,
    });
  }
}

async function handleRegenPaymentButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  const blocked = denyUnlessBuyer(interaction, deal);
  if (blocked) return blocked;
  if (!["payment_failed", "awaiting_payment"].includes(deal.status) && deal.payment_id) {
    // awaiting without usable payment also ok via payment_failed
  }
  if (!["payment_failed", "awaiting_payment"].includes(deal.status)) {
    return deny(interaction, "Can't regenerate an address at this stage.");
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (deal.status !== "funds_held" && !(deal.status === "disputed" && isStaff(interaction.member))) {
    // release from funds_held only here; staff dispute uses staff_release
    if (deal.status !== "funds_held") {
      return deny(interaction, "Funds are not in escrow yet.");
    }
  }
  const blocked = denyUnlessBuyer(interaction, deal);
  if (blocked) return blocked;
  if (!deal.seller_wallet) {
    return deny(
      interaction,
      `The seller must first set their ${deal.crypto || "crypto"} address (Seller address button).`
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

    await logAdmin(interaction.client, `Payout broadcast #${dealCodeTag(dealCode)}`, [
      `${e("release")}Transaction broadcast to seller`,
      formatTxidLine(result.payoutId, { crypto: deal.crypto || "LTC" }),
      `${e("wallet")}**To** — \`${deal.seller_wallet}\``,
      ...formatBuyerSellerLines(deal),
    ]);

    return interaction.editReply({
      content: `${e("success")}Payout started to the seller.`,
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
        `${e("error")}Payout failed: \`${err.message}\`\n` +
        `The deal stays in **secured funds** — you can retry.`,
    });
  }
}

async function handleSellerWalletButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (!["funds_held", "disputed"].includes(deal.status)) {
    return deny(interaction, "The address can only be set once funds are secured.");
  }
  const blocked = denyUnlessSellerOnly(interaction, deal);
  if (blocked) return blocked;

  const coin = deal.crypto || "LTC";
  const modal = new ModalBuilder()
    .setCustomId(`deal_seller_wallet_modal:${dealCode}`)
    .setTitle(`${coin} withdrawal address`);

  const walletInput = new TextInputBuilder()
    .setCustomId("seller_wallet")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder(addressPlaceholder(coin));

  if (deal.seller_wallet) {
    walletInput.setValue(deal.seller_wallet);
  }

  const walletLabel = new LabelBuilder()
    .setLabel(`Seller's ${networkName(coin)} address`)
    .setTextInputComponent(walletInput);

  modal.addLabelComponents(walletLabel);
  await interaction.showModal(modal);
}

async function handleSellerWalletModal(interaction) {
  const dealCode = interaction.customId.split(":")[1];
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  const blocked = denyUnlessSellerOnly(interaction, deal);
  if (blocked) return blocked;

  const coin = deal.crypto || "LTC";
  const wallet = interaction.fields.getTextInputValue("seller_wallet").trim();
  if (!isValidAddress(coin, wallet)) {
    return deny(
      interaction,
      `Invalid ${coin} address. Use a ${addressHint(coin)}.`
    );
  }

  db.prepare(
    `UPDATE deals
     SET seller_wallet = @seller_wallet, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ seller_wallet: wallet, deal_code: dealCode });

  const updatedDeal = getDealByCode(dealCode);

  await interaction.reply({
    content: `${e("success")}Withdrawal address saved: \`${wallet}\``,
    flags: MessageFlags.Ephemeral,
  });

  const updated = await updateFundsHeldMessage(updatedDeal);
  if (!updated && updatedDeal.status === "disputed") {
    // rien
  }
}

async function handleDisputeButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (!["funds_held", "awaiting_payment", "payment_failed"].includes(deal.status)) {
    return deny(interaction, "A dispute can't be opened at this stage.");
  }
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "This deal doesn't involve you.");
  }

  const modal = new ModalBuilder()
    .setCustomId(`deal_dispute_modal:${dealCode}`)
    .setTitle("Open a dispute");

  const reasonLabel = new LabelBuilder()
    .setLabel("Dispute reason")
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
  if (!deal) return deny(interaction, "Deal not found.");
  if (!isParticipant(deal, interaction.user.id) && !isStaff(interaction.member)) {
    return deny(interaction, "This deal doesn't involve you.");
  }

  const reason = interaction.fields.getTextInputValue("dispute_reason").trim();
  if (!reason) return deny(interaction, "A dispute reason is required.");

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

  await logAdmin(interaction.client, `Dispute opened #${dealCodeTag(dealCode)}`, [
    `${e("warning")}Opened by <@${interaction.user.id}>`,
    `**Reason** — ${reason.slice(0, 300)}`,
    ...formatBuyerSellerLines(updatedDeal),
    formatTxidLine(updatedDeal.payout_id, { crypto: updatedDeal.crypto || "LTC" }),
  ]);
}

async function handleStaffReleaseButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Staff only.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (deal.status !== "disputed" && deal.status !== "funds_held") {
    return deny(interaction, "Staff release isn't possible at this stage.");
  }
  if (!deal.seller_wallet) {
    return deny(interaction, `The seller must have a ${deal.crypto || "crypto"} address first.`);
  }

  // Réutilise la logique release
  db.prepare(
    `UPDATE deals SET status = 'funds_held', mediator_id = @mediator_id WHERE deal_code = @deal_code`
  ).run({ mediator_id: interaction.user.id, deal_code: dealCode });

  return handleReleaseButton(interaction, dealCode);
}

async function handleStaffResolveButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Staff only.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (deal.status !== "disputed") {
    return deny(interaction, "This deal is not in dispute.");
  }

  db.prepare(
    `UPDATE deals
     SET status = 'cancelled',
         mediator_id = @mediator_id,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ mediator_id: interaction.user.id, deal_code: dealCode });

  const updated = getDealByCode(dealCode);

  await interaction.update({
    components: [buildCloseTicketContainer(updated, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });

  await interaction.channel.send({
    content:
      `${e("staff")}Dispute #${dealCodeTag(dealCode)} closed by <@${interaction.user.id}> **without auto payout**.\n` +
      `${e("warning")}If funds remain on the escrow address, manage them manually with the seed.`,
  });

  await logAdmin(interaction.client, `Dispute closed #${dealCodeTag(dealCode)}`, [
    `${e("staff")}Closed without payout by <@${interaction.user.id}>`,
    `${e("product")}**Produit** — ${updated.product}`,
    ...formatBuyerSellerLines(updated),
    formatTxidLine(updated.payout_id, { crypto: updated.crypto || "LTC" }),
  ]);
}

async function handleStaffRefundButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Staff only.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (!["disputed", "funds_held"].includes(deal.status)) {
    return deny(interaction, "Refund isn't possible at this stage.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const detected = await findBuyerRefundAddress(deal);
    const buyerWallet = detected.address;

    db.prepare(
      `UPDATE deals
       SET buyer_wallet = @buyer_wallet,
           mediator_id = @mediator_id,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      buyer_wallet: buyerWallet,
      mediator_id: interaction.user.id,
      deal_code: dealCode,
    });

    const result = await refundToBuyer(getDealByCode(dealCode), buyerWallet);

    db.prepare(
      `UPDATE deals
       SET status = 'refunding',
           payout_id = @payout_id,
           payout_status = @payout_status,
           payout_error = NULL,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      payout_id: result.payoutId,
      payout_status: result.status || "processing",
      deal_code: dealCode,
    });

    const updated = getDealByCode(dealCode);

    await interaction.channel.send({
      components: [buildRefundPendingContainer(updated)],
      flags: MessageFlags.IsComponentsV2,
    });

    await logAdmin(interaction.client, `Refund broadcast #${dealCodeTag(dealCode)}`, [
      `${e("money")}Auto refund started by <@${interaction.user.id}>`,
      `${e("wallet")}**Address (detected)** — \`${buyerWallet}\``,
      formatTxidLine(result.payoutId, { crypto: deal.crypto || "LTC" }),
      ...formatBuyerSellerLines(updated),
      `${e("clock")}Awaiting blockchain confirmation`,
    ]);

    return interaction.editReply({
      content: `${e("success")}Refund started to \`${buyerWallet}\` — confirmation in progress.`,
    });
  } catch (err) {
    console.error("Remboursement auto:", err.message);
    db.prepare(
      `UPDATE deals SET payout_error = @err, updated_at = datetime('now') WHERE deal_code = @deal_code`
    ).run({ err: err.message, deal_code: dealCode });

    return interaction.editReply({
      content:
        `${e("warning")}Auto-detect failed: \`${err.message}\`\n` +
        `You can enter the ${deal.crypto || "crypto"} address manually:`,
      components: [
        new ActionRowBuilder().addComponents(
          (() => {
            const btn = new ButtonBuilder()
              .setCustomId(`deal_staff_refund_manual:${dealCode}`)
              .setLabel(`Enter ${deal.crypto || "crypto"} address`)
              .setStyle(ButtonStyle.Primary);
            if (config.emojis.wallet) btn.setEmoji(config.emojis.wallet);
            return btn;
          })()
        ),
      ],
    });
  }
}

async function handleStaffRefundManualButton(interaction, dealCode) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Staff only.");
  }

  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");

  const coin = deal.crypto || "LTC";
  const modal = new ModalBuilder()
    .setCustomId(`deal_staff_refund_modal:${dealCode}`)
    .setTitle("Refund customer");

  const walletInput = new TextInputBuilder()
    .setCustomId("buyer_wallet")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder(addressPlaceholder(coin));
  if (deal.buyer_wallet) walletInput.setValue(deal.buyer_wallet);

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(`Customer's ${coin} address`)
      .setTextInputComponent(walletInput)
  );
  await interaction.showModal(modal);
}

async function handleStaffRefundModal(interaction) {
  if (!isStaff(interaction.member)) {
    return deny(interaction, "Staff only.");
  }

  const dealCode = interaction.customId.split(":")[1];
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (!["disputed", "funds_held"].includes(deal.status)) {
    return deny(interaction, "Refund isn't possible at this stage.");
  }

  const coin = deal.crypto || "LTC";
  const buyerWallet = interaction.fields.getTextInputValue("buyer_wallet").trim();
  if (!isValidAddress(coin, buyerWallet)) {
    return deny(interaction, `Invalid ${coin} address.`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  db.prepare(
    `UPDATE deals
     SET buyer_wallet = @buyer_wallet,
         mediator_id = @mediator_id,
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    buyer_wallet: buyerWallet,
    mediator_id: interaction.user.id,
    deal_code: dealCode,
  });

  try {
    const result = await refundToBuyer(getDealByCode(dealCode), buyerWallet);

    db.prepare(
      `UPDATE deals
       SET status = 'refunding',
           payout_id = @payout_id,
           payout_status = @payout_status,
           payout_error = NULL,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      payout_id: result.payoutId,
      payout_status: result.status || "processing",
      deal_code: dealCode,
    });

    const updated = getDealByCode(dealCode);

    await interaction.channel.send({
      components: [buildRefundPendingContainer(updated)],
      flags: MessageFlags.IsComponentsV2,
    });

    await logAdmin(interaction.client, `Refund broadcast #${dealCodeTag(dealCode)}`, [
      `${e("money")}Refund started by <@${interaction.user.id}>`,
      `${e("wallet")}**Address** — \`${buyerWallet}\``,
      formatTxidLine(result.payoutId, { crypto: deal.crypto || "LTC" }),
      ...formatBuyerSellerLines(updated),
      `${e("clock")}Awaiting blockchain confirmation`,
    ]);

    return interaction.editReply({
      content: `${e("success")}Refund started — confirmation in progress.`,
    });
  } catch (err) {
    console.error("Remboursement:", err.message);
    db.prepare(
      `UPDATE deals SET payout_error = @err, updated_at = datetime('now') WHERE deal_code = @deal_code`
    ).run({ err: err.message, deal_code: dealCode });

    return interaction.editReply({
      content: `${e("error")}Refund failed: \`${err.message}\``,
    });
  }
}

async function handleReviewButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (deal.status !== "awaiting_review") {
    return deny(interaction, "The review is only available after payout confirmation.");
  }
  const blocked = denyUnlessBuyer(interaction, deal);
  if (blocked) return blocked;
  if (deal.review_at) {
    return deny(interaction, "A review was already submitted for this deal.");
  }

  const modal = new ModalBuilder()
    .setCustomId(`deal_review_modal:${dealCode}`)
    .setTitle("Bot review");

  const ratingLabel = new LabelBuilder()
    .setLabel("Rating")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("review_rating")
        .setPlaceholder("Choose a rating")
        .setRequired(true)
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("★★★★★").setValue("5"),
          new StringSelectMenuOptionBuilder().setLabel("★★★★☆").setValue("4"),
          new StringSelectMenuOptionBuilder().setLabel("★★★☆☆").setValue("3"),
          new StringSelectMenuOptionBuilder().setLabel("★★☆☆☆").setValue("2"),
          new StringSelectMenuOptionBuilder().setLabel("★☆☆☆☆").setValue("1")
        )
    );

  const textLabel = new LabelBuilder()
    .setLabel("Your review")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("review_text")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(800)
        .setPlaceholder("Your experience with the escrow bot…")
    );

  modal.addLabelComponents(ratingLabel, textLabel);
  await interaction.showModal(modal);
}

async function handleReviewModal(interaction) {
  const dealCode = interaction.customId.split(":")[1];
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");
  if (deal.status !== "awaiting_review") {
    return deny(interaction, "Reviews are no longer accepted for this deal.");
  }
  const blocked = denyUnlessBuyer(interaction, deal);
  if (blocked) return blocked;
  if (deal.review_at) {
    return deny(interaction, "A review was already submitted.");
  }

  const rating = Number(interaction.fields.getStringSelectValues("review_rating")[0]);
  const text = interaction.fields.getTextInputValue("review_text").trim();
  const anonymous = isUserAnonymous(interaction.user.id);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return deny(interaction, "Invalid rating.");
  }
  if (!text) {
    return deny(interaction, "The review can't be empty.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  db.prepare(
    `UPDATE deals
     SET review_text = @review_text,
         review_rating = @review_rating,
         review_anonymous = @review_anonymous,
         review_at = datetime('now'),
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    review_text: text,
    review_rating: rating,
    review_anonymous: anonymous ? 1 : 0,
    deal_code: dealCode,
  });

  const updated = getDealByCode(dealCode);
  const reviewContainer = buildPublicReviewContainer(updated, {
    botId: interaction.client.user?.id,
  });

  try {
    await finalizeDealAfterReview(interaction.client, updated, {
      reviewContainer,
      guildId: interaction.guildId,
      reviewerId: interaction.user.id,
      guild: interaction.guild,
      member: interaction.member,
    });
    return interaction.editReply({
      content: `${e("success")}Review saved. The deal is closing — transcript is being sent.`,
    });
  } catch (err) {
    console.error("Finalisation deal:", err);
    return interaction.editReply({
      content: `${e("error")}Review saved but finalization incomplete: \`${err.message}\``,
    });
  }
}

function getStaffRoleId() {
  const raw = String(config.staffRoleId || process.env.STAFF_ROLE_ID || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{16,22})/);
  return m ? m[1] : null;
}

const STAFF_PING_LIMIT = 2;

function getStaffPingCount(dealCode, userId) {
  const row = db
    .prepare(
      `SELECT ping_count FROM deal_staff_pings WHERE deal_code = ? AND user_id = ?`
    )
    .get(dealCode, userId);
  return row ? Number(row.ping_count) || 0 : 0;
}

function incrementStaffPingCount(dealCode, userId) {
  db.prepare(
    `INSERT INTO deal_staff_pings (deal_code, user_id, ping_count)
     VALUES (?, ?, 1)
     ON CONFLICT(deal_code, user_id) DO UPDATE SET ping_count = ping_count + 1`
  ).run(dealCode, userId);
  return getStaffPingCount(dealCode, userId);
}

/** Bouton Staff — ping le rôle staff dans le salon de deal (max 2 / user / deal). */
async function handleStaffPingButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");

  const staffRoleId = getStaffRoleId();
  if (!staffRoleId) {
    return deny(interaction, "Staff role is not configured (`STAFF_ROLE_ID`).");
  }

  const used = getStaffPingCount(dealCode, interaction.user.id);
  if (used >= STAFF_PING_LIMIT) {
    return deny(
      interaction,
      `Staff ping limit reached (**${STAFF_PING_LIMIT}/${STAFF_PING_LIMIT}** for this deal).`
    );
  }

  const next = incrementStaffPingCount(dealCode, interaction.user.id);

  await interaction.reply({
    content:
      `${e("staff")}<@&${staffRoleId}> — <@${interaction.user.id}> needs help with deal #${dealCodeTag(dealCode)}.\n` +
      `${e("info")}Pings left for you: **${STAFF_PING_LIMIT - next}/${STAFF_PING_LIMIT}**`,
    allowedMentions: { parse: [], roles: [staffRoleId], users: [interaction.user.id] },
  });
}

async function handleCloseButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) return deny(interaction, "Deal not found.");

  if (!isStaff(interaction.member)) {
    return deny(interaction, "Only staff can close this channel.");
  }

  await logAdmin(interaction.client, `Channel closed #${dealCodeTag(dealCode)}`, [
    `${e("close")}Closed by <@${interaction.user.id}>`,
    `**Deal status** — ${deal.status}`,
    ...formatBuyerSellerLines(deal),
    formatTxidLine(deal.payout_id, { crypto: deal.crypto || "LTC" }),
  ]);

  await interaction.reply({
    content: `${e("close")}Channel closed by <@${interaction.user.id}>. Deleting in 5 seconds...`,
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
  handleStaffRefundButton,
  handleStaffRefundManualButton,
  handleStaffRefundModal,
  handleCloseButton,
  handleReviewButton,
  handleReviewModal,
  handleStaffPingButton,
  getDealByCode,
};
