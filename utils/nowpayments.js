const config = require("../config");

const API_BASE = "https://api.nowpayments.io/v1";

const PAID_STATUSES = new Set(["finished"]);
const ACTIVE_STATUSES = new Set(["waiting", "confirming", "confirmed", "sending", "partially_paid"]);
const TERMINAL_FAIL_STATUSES = new Set(["failed", "expired", "refunded"]);

function fiatCurrencyCode(currencySymbol) {
  if (currencySymbol === "€") return "eur";
  if (currencySymbol === "$") return "usd";
  return String(currencySymbol || "").toLowerCase();
}

function statusLabel(status) {
  const labels = {
    waiting: "En attente de paiement",
    confirming: "Confirmation blockchain",
    confirmed: "Confirmé on-chain",
    sending: "Envoi vers le wallet escrow",
    partially_paid: "Paiement partiel",
    finished: "Paiement reçu",
    failed: "Échec",
    expired: "Expiré",
    refunded: "Remboursé",
  };
  return labels[status] || status || "Inconnu";
}

async function nowpaymentsRequest(method, path, body) {
  if (!config.nowpaymentsApiKey) {
    throw new Error("NOWPAYMENTS_API_KEY manquant dans le .env");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "x-api-key": config.nowpaymentsApiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Crée un paiement LTC via NOWPayments pour un deal.
 * @param {object} deal
 */
async function createLtcPayment(deal) {
  const priceCurrency = fiatCurrencyCode(deal.currency);
  const payCurrency = String(deal.crypto || "LTC").toLowerCase();

  const payload = {
    price_amount: Number(deal.price),
    price_currency: priceCurrency,
    pay_currency: payCurrency,
    order_id: deal.deal_code,
    order_description: `Escrow deal #${deal.deal_code} — ${deal.product}`,
    is_fixed_rate: true,
  };

  if (config.nowpaymentsIpnUrl) {
    payload.ipn_callback_url = config.nowpaymentsIpnUrl;
  }

  return nowpaymentsRequest("POST", "/payment", payload);
}

async function getPaymentStatus(paymentId) {
  return nowpaymentsRequest("GET", `/payment/${paymentId}`);
}

function isPaidStatus(status) {
  return PAID_STATUSES.has(status);
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function isFailedStatus(status) {
  return TERMINAL_FAIL_STATUSES.has(status);
}

module.exports = {
  createLtcPayment,
  getPaymentStatus,
  statusLabel,
  isPaidStatus,
  isActiveStatus,
  isFailedStatus,
  fiatCurrencyCode,
};
