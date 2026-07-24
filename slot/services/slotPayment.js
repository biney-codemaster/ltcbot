const {
  createPayment,
  formatCryptoAmount,
  cryptoEmoji,
  getCryptoAsset,
} = require("../../utils/cryptoWallet");
const config = require("../config");
const { getPlan, isPaidPlan } = require("../plans");
const slotService = require("./slotService");
const purchaseService = require("./purchaseService");

const SLOT_PAY_CRYPTO = "LTC";

function assertCanBuy(guildId, userId, planId) {
  const plan = getPlan(planId);
  if (!plan || !plan.paid) {
    return { ok: false, error: "Unknown paid plan." };
  }
  if (slotService.getSlot(guildId, userId)) {
    return { ok: false, error: "You already have an active slot." };
  }
  const open = purchaseService.getOpenPurchaseForUser(guildId, userId);
  if (open) {
    return {
      ok: false,
      error: `You already have an open invoice (\`${open.purchase_code}\`). Pay it or wait for it to expire.`,
      open,
    };
  }
  if (slotService.countPaidSlots(guildId) >= config.maxPaidSlots) {
    return {
      ok: false,
      error: `Paid slots are full (**${config.maxPaidSlots}/${config.maxPaidSlots}**). Try again later.`,
    };
  }
  return { ok: true, plan };
}

function assertCanActivateFree(guildId) {
  if (slotService.countFreeSlots(guildId) >= config.maxFreeSlots) {
    return {
      ok: false,
      error: `Free slots are full (**${config.maxFreeSlots}/${config.maxFreeSlots}**). Buy a paid plan or try later.`,
    };
  }
  return { ok: true };
}

/**
 * Create LTC invoice for a paid slot (no middleman).
 * Funds go to HD address, then swept to OWNER_LTC_WALLET on confirm.
 */
async function startSlotPurchase({ guildId, userId, planId, channelId = null }) {
  const gate = assertCanBuy(guildId, userId, planId);
  if (!gate.ok) return gate;

  const plan = gate.plan;
  const stubDeal = {
    deal_code: `SLOT-PENDING-${userId}`,
    price: plan.priceEur,
    currency: "€",
    crypto: SLOT_PAY_CRYPTO,
    pay_amount: null,
  };

  let payment;
  try {
    payment = await createPayment(stubDeal);
  } catch (err) {
    console.error("slot payment create failed:", err);
    return { ok: false, error: `Could not create payment: ${err.message}` };
  }

  const payAmount = Number(payment.pay_amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return { ok: false, error: "Could not fetch live LTC rate. Try again." };
  }

  const purchase = purchaseService.createPurchase({
    guildId,
    userId,
    planId: plan.id,
    priceEur: plan.priceEur,
    crypto: SLOT_PAY_CRYPTO,
    payAmount,
    paymentId: String(payment.payment_id),
    payAddress: payment.pay_address,
    walletIndex: payment.wallet_index,
    channelId,
    expiresAt: Date.now() + config.purchaseTtlMs,
  });

  return { ok: true, purchase, plan, payment };
}

function formatInvoiceLines(purchase, plan) {
  const asset = getCryptoAsset(SLOT_PAY_CRYPTO);
  const amount = formatCryptoAmount(Number(purchase.expected_pay_amount || purchase.pay_amount));
  const icon = cryptoEmoji(SLOT_PAY_CRYPTO);
  return {
    title: `${plan.name} slot — €${plan.priceEur}/mo`,
    description:
      `${icon}Send **exactly** \`${amount} ${asset.code}\` to:\n` +
      `\`${purchase.pay_address}\`\n\n` +
      `Pings: **${plan.everyonePings}** @everyone · **${plan.herePings}** @here / day\n` +
      `Duration: **${plan.days} days**\n` +
      `Invoice: \`${purchase.purchase_code}\`\n` +
      `Expires <t:${Math.floor(purchase.expires_at / 1000)}:R>\n\n` +
      "Pay with **Litecoin (LTC) only**. No middleman — once confirmed, your slot is created automatically.\n" +
      "Wrong amount = not credited (funds routed internally).",
  };
}

module.exports = {
  SLOT_PAY_CRYPTO,
  assertCanBuy,
  assertCanActivateFree,
  startSlotPurchase,
  formatInvoiceLines,
  isPaidPlan,
};
