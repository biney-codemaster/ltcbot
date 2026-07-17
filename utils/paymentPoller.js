const db = require("../database");
const { getPaymentStatus, isPaidStatus, isFailedStatus, statusLabel } = require("./nowpayments");
const {
  buildPaymentContainer,
  buildFundsHeldContainer,
  buildPaymentFailedContainer,
} = require("./dealContainer");
const { MessageFlags } = require("discord.js");

const POLL_INTERVAL_MS = 30_000;
/** @type {import('discord.js').Client | null} */
let client = null;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

function startPaymentPoller(discordClient) {
  client = discordClient;
  if (timer) return;
  timer = setInterval(() => {
    pollActivePayments().catch((err) => {
      console.error("Erreur polling paiements:", err.message);
    });
  }, POLL_INTERVAL_MS);
  // Premier passage rapide au démarrage
  pollActivePayments().catch(() => {});
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

async function refreshDealPayment(deal) {
  if (!deal?.payment_id || !client) return deal;

  const payment = await getPaymentStatus(deal.payment_id);
  const paymentStatus = payment.payment_status;

  db.prepare(
    `UPDATE deals
     SET payment_status = @payment_status,
         pay_amount = COALESCE(@pay_amount, pay_amount),
         pay_address = COALESCE(@pay_address, pay_address),
         updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({
    payment_status: paymentStatus,
    pay_amount: payment.pay_amount != null ? Number(payment.pay_amount) : null,
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
           updated_at = datetime('now')
       WHERE deal_code = @deal_code`
    ).run({ payment_status: paymentStatus, deal_code: deal.deal_code });
    updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);
    await publishFundsHeld(updated);
    return updated;
  }

  if (isFailedStatus(paymentStatus) && updated.status === "awaiting_payment") {
    await updatePaymentMessage(updated, buildPaymentFailedContainer(updated, statusLabel(paymentStatus)));
    return updated;
  }

  await updatePaymentMessage(updated, buildPaymentContainer(updated));
  return updated;
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
          components: [buildPaymentContainer({ ...deal, payment_status: deal.payment_status || "finished" })],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch {
        // message peut avoir été supprimé
      }
    }

    await channel.send({
      components: [buildFundsHeldContainer(deal)],
      flags: MessageFlags.IsComponentsV2,
    });
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
    // silencieux: salon/message peut avoir disparu
    if (err.code !== 10008 && err.code !== 10003) {
      console.error(`Maj message paiement #${deal.deal_code}:`, err.message);
    }
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

module.exports = {
  startPaymentPoller,
  stopPaymentPoller,
  refreshDealPayment,
  pollActivePayments,
};
