const {
  getPaymentStatus,
  comparePaymentAmount,
  sweepToOwnerWallet,
  getOwnerWallet,
  createPayment,
  isPaidStatus,
  formatCryptoAmount,
  cryptoEmoji,
  resolvePayoutAmount,
} = require("../../utils/cryptoWallet");
const purchaseService = require("./purchaseService");
const { STATUS, asDealLike } = require("./purchaseService");
const { provisionSlot } = require("./provision");
const { getPlan } = require("../plans");
const slotService = require("./slotService");
const { sendLog } = require("./guildActions");
const { successEmbed, errorEmbed, warnEmbed } = require("../utils/embeds");

const POLL_MS = 5_000;
/** @type {import('discord.js').Client | null} */
let client = null;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;

function startSlotPaymentPoller(discordClient) {
  client = discordClient;
  if (timer) return;
  timer = setInterval(() => {
    pollSlotPurchases().catch((err) => {
      console.error("[slots] payment poll error:", err.message);
    });
  }, POLL_MS);
  pollSlotPurchases().catch(() => {});
}

function stopSlotPaymentPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function notifyUser(userId, payload) {
  if (!client) return;
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload).catch(() => null);
  } catch {
    /* ignore */
  }
}

async function notifyChannel(purchase, payload) {
  if (!client || !purchase.channel_id) return;
  try {
    const channel = await client.channels.fetch(purchase.channel_id);
    if (channel?.isTextBased()) {
      await channel.send({
        content: `<@${purchase.user_id}>`,
        ...payload,
        allowedMentions: { users: [purchase.user_id] },
      });
    }
  } catch (err) {
    console.warn("[slots] notify channel:", err.message);
  }
}

async function expirePurchase(purchase) {
  purchaseService.updatePurchase(purchase.id, {
    status: STATUS.EXPIRED,
    payment_status: "expired",
  });
  await notifyUser(purchase.user_id, {
    embeds: [
      warnEmbed(
        `Slot invoice \`${purchase.purchase_code}\` expired. Start a new purchase if you still want a slot.`
      ),
    ],
  });
}

async function regenerateInvoice(purchase) {
  const deal = asDealLike(purchase);
  const kept = Number(purchase.expected_pay_amount || purchase.pay_amount);
  const payment = await createPayment(deal);
  const payAmount =
    Number.isFinite(kept) && kept > 0 ? kept : Number(payment.pay_amount);

  return purchaseService.updatePurchase(purchase.id, {
    payment_id: String(payment.payment_id),
    pay_address: payment.pay_address,
    pay_amount: payAmount,
    expected_pay_amount: payAmount,
    wallet_index: payment.wallet_index,
    received_pay_amount: null,
    payment_status: "waiting",
    status: STATUS.AWAITING,
  });
}

async function completePaidPurchase(purchase, received) {
  const fresh = purchaseService.getPurchase(purchase.id);
  if (!fresh) return;
  if (
    fresh.status === STATUS.COMPLETED ||
    fresh.status === STATUS.PROVISIONING
  ) {
    return;
  }

  const plan = getPlan(fresh.plan_id);
  if (!plan) {
    console.error("[slots] unknown plan on purchase", fresh.id);
    return;
  }

  purchaseService.updatePurchase(fresh.id, {
    status: STATUS.PROVISIONING,
    payment_status: "paid",
    received_pay_amount: received,
  });

  if (slotService.getSlot(fresh.guild_id, fresh.user_id)) {
    purchaseService.updatePurchase(fresh.id, {
      status: STATUS.COMPLETED,
      payment_status: "paid",
      received_pay_amount: received,
    });
    return;
  }

  if (slotService.countPaidSlots(fresh.guild_id) >= require("../config").maxPaidSlots) {
    purchaseService.updatePurchase(fresh.id, {
      status: STATUS.PAID,
      payment_status: "paid",
      received_pay_amount: received,
    });
    await notifyUser(fresh.user_id, {
      embeds: [
        errorEmbed(
          "Payment received but paid slots are full. Contact an owner for a manual slot."
        ),
      ],
    });
    return;
  }

  const coin = fresh.crypto || "LTC";
  if (getOwnerWallet(coin)) {
    try {
      await sweepToOwnerWallet(asDealLike(fresh));
    } catch (err) {
      console.error(`[slots] sweep failed ${fresh.purchase_code}:`, err.message);
    }
  } else {
    console.warn(`[slots] OWNER_${coin}_WALLET missing — funds stay on HD address`);
  }

  const guild = await client.guilds.fetch(fresh.guild_id).catch(() => null);
  const user = guild
    ? await client.users.fetch(fresh.user_id).catch(() => null)
    : null;

  if (!guild || !user) {
    purchaseService.updatePurchase(fresh.id, {
      status: STATUS.PAID,
      payment_status: "paid",
      received_pay_amount: received,
    });
    await notifyUser(fresh.user_id, {
      embeds: [
        errorEmbed(
          `Payment confirmed (\`${fresh.purchase_code}\`) but the server was unavailable.\nContact an owner to get your slot.`
        ),
      ],
    });
    return;
  }

  const result = await provisionSlot(guild, user, {
    planId: plan.id,
    title: `${plan.name} slot`,
  });

  if (result.error) {
    purchaseService.updatePurchase(fresh.id, {
      status: STATUS.PAID,
      payment_status: "paid",
      received_pay_amount: received,
    });
    await notifyUser(fresh.user_id, {
      embeds: [
        errorEmbed(
          `Payment confirmed but slot creation failed: ${result.error}\nContact an owner with code \`${fresh.purchase_code}\`.`
        ),
      ],
    });
    await sendLog(guild, `Paid slot provision failed for <@${fresh.user_id}>`, [
      errorEmbed(`${fresh.purchase_code}: ${result.error}`),
    ]);
    return;
  }

  purchaseService.updatePurchase(fresh.id, {
    status: STATUS.COMPLETED,
    slot_id: result.slot.id,
  });

  const payload = {
    embeds: [
      successEmbed(
        `**${plan.name}** slot unlocked → <#${result.slot.channel_id}>\n` +
          `**${plan.days}d** · **${plan.everyonePings}** @everyone · **${plan.herePings}** @here / day`
      ),
    ],
  };
  await notifyUser(fresh.user_id, payload);
  await notifyChannel(fresh, payload);
}

async function refreshPurchase(purchase) {
  if (!client) return;
  if (Date.now() > purchase.expires_at) {
    await expirePurchase(purchase);
    return;
  }

  const deal = asDealLike(purchase);
  const payment = await getPaymentStatus(deal);
  const paymentStatus = payment.payment_status;
  const prev = purchase.payment_status;

  let updated = purchaseService.updatePurchase(purchase.id, {
    payment_status: paymentStatus,
    pay_address: payment.pay_address || purchase.pay_address,
  });

  if (paymentStatus === "pending" && prev !== "pending" && prev !== "paid") {
    updated = purchaseService.updatePurchase(purchase.id, { status: STATUS.PENDING });
    await notifyUser(purchase.user_id, {
      embeds: [
        warnEmbed(
          `Payment detected for \`${purchase.purchase_code}\` — waiting for confirmations…`
        ),
      ],
    });
  }

  if (!isPaidStatus(paymentStatus)) return;

  const received =
    resolvePayoutAmount(deal, payment) ?? Number(payment.actually_paid);
  const cmp = comparePaymentAmount(deal, received);
  const coin = purchase.crypto || "LTC";
  const icon = cryptoEmoji(coin);
  const fmt = (n) => `\`${formatCryptoAmount(Number(n)) || "—"} ${coin}\``;

  if (cmp === "under") {
    if (!getOwnerWallet(coin)) {
      console.error(
        `[slots] Underpay ${purchase.purchase_code} but OWNER_${coin}_WALLET missing`
      );
      return;
    }
    try {
      await sweepToOwnerWallet(asDealLike(updated));
    } catch (err) {
      console.error(`[slots] underpay sweep:`, err.message);
      return;
    }
    const next = await regenerateInvoice(updated);
    await notifyUser(purchase.user_id, {
      embeds: [
        warnEmbed(
          `Amount too low (${icon}${fmt(received)} / expected ${fmt(
            purchase.expected_pay_amount
          )}).\n` +
            `Send **exactly** \`${formatCryptoAmount(Number(next.expected_pay_amount))} ${coin}\` to:\n` +
            `\`${next.pay_address}\``
        ),
      ],
    });
    return;
  }

  if (cmp === "exact" || cmp === "over") {
    await completePaidPurchase(updated, received);
  }
}

async function pollSlotPurchases() {
  const rows = purchaseService.getAwaitingPurchases();
  // also refresh "pending" status rows
  const pending = require("../database/db")
    .prepare(
      `SELECT * FROM slot_purchases
       WHERE status IN (?, ?)
         AND payment_id IS NOT NULL`
    )
    .all(STATUS.AWAITING, STATUS.PENDING);

  const seen = new Set();
  for (const purchase of [...rows, ...pending]) {
    if (seen.has(purchase.id)) continue;
    seen.add(purchase.id);
    try {
      // eslint-disable-next-line no-await-in-loop
      await refreshPurchase(purchase);
    } catch (err) {
      console.error(`[slots] refresh ${purchase.purchase_code}:`, err.message);
    }
  }
}

/** Manual check from button — same logic as poller tick. */
async function checkPurchaseNow(purchaseId) {
  const purchase = purchaseService.getPurchase(purchaseId);
  if (!purchase) return { ok: false, error: "Invoice not found." };
  if (purchase.status === STATUS.COMPLETED) {
    return { ok: true, done: true, purchase };
  }
  if (purchase.status === STATUS.EXPIRED || purchase.status === STATUS.CANCELLED) {
    return { ok: false, error: `Invoice is ${purchase.status}.` };
  }
  await refreshPurchase(purchase);
  return { ok: true, purchase: purchaseService.getPurchase(purchaseId) };
}

module.exports = {
  startSlotPaymentPoller,
  stopSlotPaymentPoller,
  checkPurchaseNow,
  refreshPurchase,
};
