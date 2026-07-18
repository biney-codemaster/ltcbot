const db = require("../database");
const {
  getPaymentStatus,
  getPayoutStatus,
  isPaidStatus,
  isFailedStatus,
  statusLabel,
  resolvePayoutAmount,
  isPayoutDoneStatus,
  isPayoutFailedStatus,
  findFundingTxid,
  comparePaymentAmount,
  createLtcPayment,
  sweepToOwnerWallet,
  getOwnerLtcWallet,
} = require("./ltcWallet");
const {
  buildPaymentContainer,
  buildFundsHeldContainer,
  buildPaymentFailedContainer,
  buildPaymentRetryContainer,
  buildPayoutConfirmedContainer,
  buildReviewRequestContainer,
  buildCloseTicketContainer,
} = require("./dealContainer");
const { MessageFlags } = require("discord.js");
const { e } = require("../config");
const {
  logAdmin,
  dealCodeTag,
  formatTxidLine,
  formatBuyerSellerLines,
} = require("./dealLogger");
const { formatLtcAmount } = require("./ltcPrice");

const POLL_INTERVAL_MS = 5_000;
/** @type {import('discord.js').Client | null} */
let client = null;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

function startPaymentPoller(discordClient) {
  client = discordClient;
  if (timer) return;
  timer = setInterval(() => {
    Promise.all([pollActivePayments(), pollActivePayouts()]).catch((err) => {
      console.error("Erreur polling:", err.message);
    });
  }, POLL_INTERVAL_MS);
  pollActivePayments().catch(() => {});
  pollActivePayouts().catch(() => {});
}

function stopPaymentPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

function getAwaitingDeals() {
  return db
    .prepare(
      `SELECT * FROM deals
       WHERE status = 'awaiting_payment'
         AND payment_id IS NOT NULL
         AND payment_id != ''`
    )
    .all();
}

function getPendingPayoutDeals() {
  return db
    .prepare(
      `SELECT * FROM deals
       WHERE status IN ('released', 'refunding')
         AND payout_id IS NOT NULL
         AND payout_id != ''
         AND payout_status IS NOT NULL
         AND payout_status NOT IN ('finished', 'confirmed', 'completed', 'done', 'failed', 'rejected', 'expired', 'canceled', 'error')`
    )
    .all();
}

async function regeneratePaymentAfterIncorrect(deal) {
  const keptExpected = Number(deal.expected_pay_amount ?? deal.pay_amount);
  const payment = await createLtcPayment(deal);
  const payAmount = Number.isFinite(keptExpected) && keptExpected > 0
    ? keptExpected
    : payment.pay_amount;

  db.prepare(
    `UPDATE deals
     SET payment_id = @payment_id,
         pay_address = @pay_address,
         pay_amount = @pay_amount,
         expected_pay_amount = @expected_pay_amount,
         received_pay_amount = NULL,
         payment_status = 'waiting',
         wallet_index = @wallet_index,
         status = 'awaiting_payment',
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_id: String(payment.payment_id),
    pay_address: payment.pay_address,
    pay_amount: payAmount,
    expected_pay_amount: payAmount,
    wallet_index: payment.wallet_index,
    deal_code: deal.deal_code,
  });

  const updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
  if (!client || !updated.channel_id) return updated;

  try {
    const channel = await client.channels.fetch(updated.channel_id);
    if (channel?.isTextBased()) {
      const msg = await channel.send({
        components: [buildPaymentRetryContainer(updated)],
        flags: MessageFlags.IsComponentsV2,
      });
      db.prepare(
        `UPDATE deals SET payment_message_id = @id WHERE deal_code = @deal_code`
      ).run({ id: msg.id, deal_code: updated.deal_code });
    }
  } catch (err) {
    console.error(`Retry payment msg #${deal.deal_code}:`, err.message);
  }

  return db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
}

async function refreshDealPayment(deal) {
  if (!deal?.payment_id || !client) return deal;
  if (deal.payment_status === "incorrect_processing") return deal;

  const payment = await getPaymentStatus(deal.payment_id);
  const paymentStatus = payment.payment_status;

  db.prepare(
    `UPDATE deals
     SET payment_status = @payment_status,
         pay_address = COALESCE(@pay_address, pay_address),
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_status: paymentStatus,
    pay_address: payment.pay_address || null,
    deal_code: deal.deal_code,
  });

  let updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);

  if (isPaidStatus(paymentStatus) && updated.status === "awaiting_payment") {
    const received =
      resolvePayoutAmount(updated, payment) ?? Number(payment.actually_paid);
    const cmp = comparePaymentAmount(updated, received);

    // Sous-paiement → sweep owner silencieux + nouvelle adresse (ticket sans mention owner)
    if (cmp === "under") {
      if (!getOwnerLtcWallet()) {
        console.error(
          `[payment] Sous-paiement #${updated.deal_code} mais OWNER_LTC_WALLET manquant`
        );
        await logAdmin(client, `Sous-paiement KO #${dealCodeTag(updated.deal_code)}`, [
          `${e("error")}OWNER_LTC_WALLET manquant — fonds non routés`,
          `${e("ltc")}**Reçu** — \`${formatLtcAmount(Number(received)) || "—"} LTC\``,
          `${e("ltc")}**Attendu** — \`${formatLtcAmount(Number(updated.expected_pay_amount || updated.pay_amount)) || "—"} LTC\``,
          ...formatBuyerSellerLines(updated),
        ]);
        return updated;
      }

      db.prepare(
        `UPDATE deals
         SET payment_status = 'incorrect_processing',
             received_pay_amount = @received,
             updated_at = datetime('now')
         WHERE deal_code = @deal_code`
      ).run({ received, deal_code: updated.deal_code });

      try {
        const sweep = await sweepToOwnerWallet(updated);
        await logAdmin(client, `Sous-paiement #${dealCodeTag(updated.deal_code)}`, [
          `${e("warning")}Montant insuffisant — fonds routés owner (interne)`,
          `${e("ltc")}**Reçu** — \`${formatLtcAmount(Number(received)) || "—"} LTC\``,
          `${e("ltc")}**Attendu** — \`${formatLtcAmount(Number(updated.expected_pay_amount || updated.pay_amount)) || "—"} LTC\``,
          formatTxidLine(sweep.payoutId),
          ...formatBuyerSellerLines(updated),
        ]);
      } catch (err) {
        console.error(`Sweep underpay #${updated.deal_code}:`, err.message);
        db.prepare(
          `UPDATE deals SET payment_status = 'waiting', updated_at = datetime('now')
           WHERE deal_code = ?`
        ).run(updated.deal_code);
        await logAdmin(client, `Sous-paiement sweep KO #${dealCodeTag(updated.deal_code)}`, [
          `${e("error")}${err.message}`,
        ]);
        return db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
      }

      return regeneratePaymentAfterIncorrect(updated);
    }

    // Exact ou surpaiement → escrow (surplus géré au payout vendeur, silencieux)
    db.prepare(
      `UPDATE deals
       SET status = 'funds_held',
           paid_at = datetime('now'),
           payment_status = 'paid',
           received_pay_amount = @received,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      received,
      deal_code: updated.deal_code,
    });
    updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
    await publishFundsHeld(updated);
    const fundingTxid = await findFundingTxid(updated).catch(() => null);
    await logAdmin(client, `Paiement reçu #${dealCodeTag(updated.deal_code)}`, [
      `${e("shield")}Fonds sécurisés en escrow`,
      `${e("ltc")}**Attendu** — \`${formatLtcAmount(Number(updated.expected_pay_amount || updated.pay_amount)) || "—"} LTC\``,
      `${e("ltc")}**Reçu** — \`${formatLtcAmount(Number(received)) || "—"} LTC\``,
      cmp === "over" ? `${e("info")}Surpaiement — surplus owner au payout (interne)` : null,
      `${e("wallet")}**Adresse** — \`${updated.pay_address || "—"}\``,
      formatTxidLine(fundingTxid),
      ...formatBuyerSellerLines(updated),
    ]);
    return updated;
  }

  if (isFailedStatus(paymentStatus) && updated.status === "awaiting_payment") {
    db.prepare(
      `UPDATE deals
       SET status = 'payment_failed',
           payment_status = @payment_status,
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({ payment_status: paymentStatus, deal_code: deal.deal_code });
    updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
    await updatePaymentMessage(
      updated,
      buildPaymentFailedContainer(updated, statusLabel(paymentStatus))
    );
    return updated;
  }

  // Ne pas modifier le container d'adresse pour les simples changements de statut
  return updated;
}

async function refreshDealPayout(deal) {
  if (!deal?.payout_id || !client) return deal;

  try {
    const payout = await getPayoutStatus(deal.payout_id);
    const payoutStatus = payout.status || deal.payout_status;
    const prevStatus = deal.payout_status;

    // Pas de changement → silence (évite le spam processing)
    if (payoutStatus === prevStatus) return deal;

    db.prepare(
      `UPDATE deals
       SET payout_status = @payout_status, updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({ payout_status: payoutStatus, deal_code: deal.deal_code });

    const updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);

    const newlyConfirmed =
      isPayoutDoneStatus(payoutStatus) && !isPayoutDoneStatus(prevStatus);
    const newlyFailed =
      isPayoutFailedStatus(payoutStatus) && !isPayoutFailedStatus(prevStatus);

    if ((newlyConfirmed || newlyFailed) && deal.channel_id) {
      try {
        const channel = await client.channels.fetch(deal.channel_id);
        if (channel?.isTextBased()) {
          if (newlyConfirmed) {
            // Remboursement staff → attendre confirm puis container de fermeture
            if (deal.status === "refunding") {
              db.prepare(
                `UPDATE deals
                 SET status = 'refunded',
                     payout_status = @payout_status,
                     updated_at = datetime('now')
                 WHERE deal_code = @deal_code`
              ).run({ payout_status: payoutStatus, deal_code: deal.deal_code });

              const refunded = db
                .prepare("SELECT * FROM deals WHERE deal_code = ?")
                .get(deal.deal_code);

              await channel.send({
                components: [
                  buildCloseTicketContainer(refunded, refunded.mediator_id, {
                    reason: "refunded",
                  }),
                ],
                flags: MessageFlags.IsComponentsV2,
              });

              await logAdmin(client, `Remboursement confirmé #${dealCodeTag(deal.deal_code)}`, [
                `${e("success")}Fonds renvoyés à l'acheteur`,
                formatTxidLine(deal.payout_id),
                `${e("wallet")}**Adresse** — \`${deal.buyer_wallet || "—"}\``,
                ...formatBuyerSellerLines(refunded),
              ]);

              return refunded;
            }

            db.prepare(
              `UPDATE deals
               SET status = 'awaiting_review',
                   payout_status = @payout_status,
                   updated_at = datetime('now')
               WHERE deal_code = @deal_code`
            ).run({ payout_status: payoutStatus, deal_code: deal.deal_code });

            const confirmed = db
              .prepare("SELECT * FROM deals WHERE deal_code = ?")
              .get(deal.deal_code);

            await channel.send({
              components: [buildPayoutConfirmedContainer(confirmed)],
              flags: MessageFlags.IsComponentsV2,
            });

            if (!confirmed.review_prompted) {
              await channel.send({
                components: [buildReviewRequestContainer(confirmed)],
                flags: MessageFlags.IsComponentsV2,
              });
              db.prepare(
                `UPDATE deals SET review_prompted = 1 WHERE deal_code = ?`
              ).run(deal.deal_code);
            }

            await logAdmin(client, `Payout confirmé #${dealCodeTag(deal.deal_code)}`, [
              `${e("success")}Fonds envoyés au vendeur`,
              formatTxidLine(deal.payout_id),
              `${e("wallet")}**Adresse** — \`${deal.seller_wallet || "—"}\``,
              ...formatBuyerSellerLines(confirmed),
              `${e("next")}En attente de l'avis acheteur`,
            ]);

            return db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
          }

          const failLabel = deal.status === "refunding" ? "Remboursement" : "Payout";
          await channel.send({
            content:
              `${e("error")}${failLabel} #${dealCodeTag(deal.deal_code)} échoué — statut **${payoutStatus}**.\n` +
              `${formatTxidLine(deal.payout_id) || ""}`,
          }).catch(() => {});

          await logAdmin(client, `${failLabel} échoué #${dealCodeTag(deal.deal_code)}`, [
            `${e("error")}Statut **${payoutStatus}**`,
            formatTxidLine(deal.payout_id),
            ...formatBuyerSellerLines(deal),
          ]);
        }
      } catch {
        // ignore
      }
    }

    return updated;
  } catch (err) {
    console.error(`Polling payout #${deal.deal_code}:`, err.message);
    return deal;
  }
}

async function publishFundsHeld(deal) {
  if (!client || !deal.channel_id) return;

  try {
    const channel = await client.channels.fetch(deal.channel_id);
    if (!channel?.isTextBased()) return;

    // Ne pas modifier le container d'adresse : envoyer un nouveau message
    const fundsMsg = await channel.send({
      components: [buildFundsHeldContainer(deal)],
      flags: MessageFlags.IsComponentsV2,
    });

    db.prepare(
      `UPDATE deals SET funds_held_message_id = @id WHERE deal_code = @deal_code`
    ).run({ id: fundsMsg.id, deal_code: deal.deal_code });
  } catch (err) {
    console.error(`Impossible de publier funds_held pour #${deal.deal_code}:`, err.message);
  }
}

async function updatePaymentMessage(deal, container) {
  if (!client || !deal.channel_id || !deal.payment_message_id) return;

  try {
    const channel = await client.channels.fetch(deal.channel_id);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(deal.payment_message_id);
    await msg.edit({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    if (err.code !== 10008 && err.code !== 10003) {
      console.error(`Maj message paiement #${deal.deal_code}:`, err.message);
    }
  }
}

async function updateFundsHeldMessage(deal) {
  if (!client || !deal.channel_id || !deal.funds_held_message_id) return false;

  try {
    const channel = await client.channels.fetch(deal.channel_id);
    if (!channel?.isTextBased()) return false;
    const msg = await channel.messages.fetch(deal.funds_held_message_id);
    await msg.edit({
      components: [buildFundsHeldContainer(deal)],
      flags: MessageFlags.IsComponentsV2,
    });
    return true;
  } catch {
    return false;
  }
}

async function pollActivePayments() {
  const deals = getAwaitingDeals();
  for (const deal of deals) {
    try {
      await refreshDealPayment(deal);
    } catch (err) {
      console.error(`Polling deal #${deal.deal_code}:`, err.message);
    }
  }
}

async function pollActivePayouts() {
  const deals = getPendingPayoutDeals();
  for (const deal of deals) {
    await refreshDealPayout(deal);
  }
}

module.exports = {
  startPaymentPoller,
  stopPaymentPoller,
  refreshDealPayment,
  refreshDealPayout,
  pollActivePayments,
  pollActivePayouts,
  updateFundsHeldMessage,
  publishFundsHeld,
};
