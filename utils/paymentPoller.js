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
} = require("./ltcWallet");
const {
  buildPaymentContainer,
  buildFundsHeldContainer,
  buildPaymentFailedContainer,
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

async function refreshDealPayment(deal) {
  if (!deal?.payment_id || !client) return deal;

  const payment = await getPaymentStatus(deal.payment_id);
  const paymentStatus = payment.payment_status;
  // Garder le montant attendu (cours) tant que non payé ; une fois payé = montant réel reçu
  const resolvedAmount = isPaidStatus(paymentStatus)
    ? resolvePayoutAmount(deal, payment)
    : deal.pay_amount;

  db.prepare(
    `UPDATE deals
     SET payment_status = @payment_status,
         pay_amount = COALESCE(@pay_amount, pay_amount),
         pay_address = COALESCE(@pay_address, pay_address),
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_status: paymentStatus,
    pay_amount: resolvedAmount,
    pay_address: payment.pay_address || null,
    deal_code: deal.deal_code,
  });

  let updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);

  if (isPaidStatus(paymentStatus) && updated.status === "awaiting_payment") {
    db.prepare(
      `UPDATE deals
       SET status = 'funds_held',
           paid_at = datetime('now'),
           payment_status = @payment_status,
           pay_amount = COALESCE(@pay_amount, pay_amount),
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({
      payment_status: paymentStatus,
      pay_amount: resolvedAmount,
      deal_code: deal.deal_code,
    });
    updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
    await publishFundsHeld(updated);
    const fundingTxid = await findFundingTxid(updated).catch(() => null);
    await logAdmin(client, `Paiement reçu #${dealCodeTag(updated.deal_code)}`, [
      `${e("shield")}Fonds sécurisés en escrow`,
      `${e("ltc")}**Montant** — \`${formatLtcAmount(Number(updated.pay_amount)) || "—"} LTC\``,
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

  await updatePaymentMessage(updated, buildPaymentContainer(updated));
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

    if (deal.payment_message_id) {
      try {
        const msg = await channel.messages.fetch(deal.payment_message_id);
        await msg.edit({
          components: [
            buildPaymentContainer({ ...deal, payment_status: deal.payment_status || "paid" }),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch {
        // message peut avoir été supprimé
      }
    }

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
