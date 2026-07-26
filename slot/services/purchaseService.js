const crypto = require("crypto");
const db = require("../database/db");

const STATUS = {
  AWAITING: "awaiting_payment",
  PENDING: "pending",
  PAID: "paid",
  PROVISIONING: "provisioning",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

function newPurchaseCode() {
  return `SLOT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function getPurchase(id) {
  return db.prepare("SELECT * FROM slot_purchases WHERE id = ?").get(id);
}

function getPurchaseByCode(code) {
  return db.prepare("SELECT * FROM slot_purchases WHERE purchase_code = ?").get(code);
}

function getAwaitingPurchases() {
  return db
    .prepare(
      `SELECT * FROM slot_purchases
       WHERE status = ?
         AND payment_id IS NOT NULL
         AND payment_id != ''`
    )
    .all(STATUS.AWAITING);
}

function getOpenPurchaseForUser(guildId, userId) {
  return db
    .prepare(
      `SELECT * FROM slot_purchases
       WHERE guild_id = ? AND user_id = ?
         AND status IN (?, ?)
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(guildId, userId, STATUS.AWAITING, STATUS.PENDING);
}

function createPurchase({
  guildId,
  userId,
  planId,
  priceEur,
  crypto,
  payAmount,
  paymentId,
  payAddress,
  walletIndex,
  channelId,
  messageId,
  expiresAt,
}) {
  const now = Date.now();
  const purchaseCode = newPurchaseCode();
  const info = db
    .prepare(
      `INSERT INTO slot_purchases (
        purchase_code, guild_id, user_id, plan_id, price_eur, crypto,
        pay_amount, expected_pay_amount, payment_id, pay_address, wallet_index,
        status, payment_status, channel_id, message_id,
        created_at, expires_at, updated_at
      ) VALUES (
        @purchase_code, @guild_id, @user_id, @plan_id, @price_eur, @crypto,
        @pay_amount, @expected_pay_amount, @payment_id, @pay_address, @wallet_index,
        @status, @payment_status, @channel_id, @message_id,
        @created_at, @expires_at, @updated_at
      )`
    )
    .run({
      purchase_code: purchaseCode,
      guild_id: guildId,
      user_id: userId,
      plan_id: planId,
      price_eur: priceEur,
      crypto,
      pay_amount: payAmount,
      expected_pay_amount: payAmount,
      payment_id: paymentId,
      pay_address: payAddress,
      wallet_index: walletIndex ?? null,
      status: STATUS.AWAITING,
      payment_status: "waiting",
      channel_id: channelId || null,
      message_id: messageId || null,
      created_at: now,
      expires_at: expiresAt,
      updated_at: now,
    });

  return getPurchase(info.lastInsertRowid);
}

function updatePurchase(id, patch) {
  const current = getPurchase(id);
  if (!current) return null;
  const next = { ...current, ...patch, updated_at: Date.now() };
  db.prepare(
    `UPDATE slot_purchases SET
      pay_amount = @pay_amount,
      expected_pay_amount = @expected_pay_amount,
      received_pay_amount = @received_pay_amount,
      payment_id = @payment_id,
      pay_address = @pay_address,
      wallet_index = @wallet_index,
      status = @status,
      payment_status = @payment_status,
      channel_id = @channel_id,
      message_id = @message_id,
      slot_id = @slot_id,
      updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    pay_amount: next.pay_amount,
    expected_pay_amount: next.expected_pay_amount,
    received_pay_amount: next.received_pay_amount ?? null,
    payment_id: next.payment_id,
    pay_address: next.pay_address,
    wallet_index: next.wallet_index,
    status: next.status,
    payment_status: next.payment_status,
    channel_id: next.channel_id,
    message_id: next.message_id,
    slot_id: next.slot_id ?? null,
    updated_at: next.updated_at,
  });
  return getPurchase(id);
}

/** Shape compatible with cryptoWallet createPayment / getPaymentStatus / sweep. */
function asDealLike(purchase) {
  return {
    deal_code: purchase.purchase_code,
    price: purchase.price_eur,
    currency: "€",
    crypto: purchase.crypto,
    pay_amount: purchase.pay_amount,
    expected_pay_amount: purchase.expected_pay_amount,
    payment_id: purchase.payment_id,
    pay_address: purchase.pay_address,
    wallet_index: purchase.wallet_index,
    payment_status: purchase.payment_status,
  };
}

module.exports = {
  STATUS,
  getPurchase,
  getPurchaseByCode,
  getAwaitingPurchases,
  getOpenPurchaseForUser,
  createPurchase,
  updatePurchase,
  asDealLike,
};
