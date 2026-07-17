const config = require("../config");
const { fiatToLtc } = require("./ltcPrice");

const API_BASE = "https://api.oxapay.com/v1";

/** Min LTC OxaPay (transfer) — ordre de grandeur doc pricing. */
const LTC_MIN_AMOUNT = 0.002;

const PAID_STATUSES = new Set(["paid", "manual_accept"]);
const ACTIVE_STATUSES = new Set(["new", "waiting", "paying", "underpaid"]);
const TERMINAL_FAIL_STATUSES = new Set(["expired", "refunded", "refunding"]);

const PAYOUT_DONE = new Set(["confirmed", "finished"]);
const PAYOUT_FAIL = new Set(["canceled", "rejected", "failed"]);

function fiatCurrencyCode(currencySymbol) {
  if (currencySymbol === "€") return "eur";
  if (currencySymbol === "$") return "usd";
  return String(currencySymbol || "usd").toLowerCase();
}

function statusLabel(status) {
  const labels = {
    new: "Facture créée",
    waiting: "En attente de paiement",
    paying: "Paiement en cours",
    paid: "Paiement reçu",
    manual_accept: "Accepté manuellement",
    underpaid: "Paiement partiel",
    expired: "Expiré",
    refunding: "Remboursement en cours",
    refunded: "Remboursé",
    processing: "Payout en traitement",
    pending: "Payout en file",
    confirming: "Confirmation blockchain",
    confirmed: "Payout confirmé",
    canceled: "Payout annulé",
    rejected: "Payout rejeté",
  };
  return labels[status] || status || "Inconnu";
}

function isValidLtcAddress(address) {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  if (/^ltc1[a-z0-9]{25,90}$/i.test(trimmed)) return true;
  if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  return false;
}

function extractErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (data.error?.message) return data.error.message;
  if (typeof data.error === "string") return data.error;
  if (data.message && data.status && data.status !== 200) return data.message;
  return fallback;
}

async function oxapayRequest(method, path, body, { apiKeyHeader, apiKey } = {}) {
  if (!apiKey) {
    throw new Error(`${apiKeyHeader || "API key"} manquant dans le .env`);
  }

  const headers = {
    "Content-Type": "application/json",
    [apiKeyHeader]: apiKey,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  const httpOk = res.ok;
  const apiOk = data.status === undefined || data.status === 200;

  if (!httpOk || !apiOk) {
    throw new Error(extractErrorMessage(data, `HTTP ${res.status}`));
  }

  return data.data !== undefined ? data.data : data;
}

function merchantRequest(method, path, body) {
  return oxapayRequest(method, path, body, {
    apiKeyHeader: "merchant_api_key",
    apiKey: config.oxapayMerchantApiKey,
  });
}

function payoutRequest(method, path, body) {
  return oxapayRequest(method, path, body, {
    apiKeyHeader: "payout_api_key",
    apiKey: config.oxapayPayoutApiKey,
  });
}

/**
 * Soft-check vs min LTC OxaPay (~0.002). Bloque tôt si cours dispo.
 */
async function assertAboveMinAmount(deal) {
  const price = Number(deal.price);
  const currency = deal.currency;
  let cryptoAmount = Number(deal.pay_amount);

  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    try {
      const { cryptoAmount: estimated } = await fiatToLtc(price, currency);
      cryptoAmount = estimated;
    } catch {
      return { minCrypto: LTC_MIN_AMOUNT, estimated: null };
    }
  }

  if (Number.isFinite(cryptoAmount) && cryptoAmount < LTC_MIN_AMOUNT) {
    const err = new Error(
      `Montant trop bas pour OxaPay (LTC). Minimum ≈ ${LTC_MIN_AMOUNT} LTC ` +
        `(ton deal ≈ ${cryptoAmount.toFixed(8)} LTC / ${price}${currency}). ` +
        `Augmente légèrement le prix.`
    );
    err.code = "BELOW_MINIMUM";
    err.minCrypto = LTC_MIN_AMOUNT;
    throw err;
  }

  return { minCrypto: LTC_MIN_AMOUNT, estimated: cryptoAmount };
}

/**
 * Crée un paiement white-label LTC. Fonds restent sur le solde OxaPay (escrow).
 */
async function createLtcPayment(deal) {
  if (!config.oxapayMerchantApiKey) {
    throw new Error("OXAPAY_MERCHANT_API_KEY manquant dans le .env");
  }

  try {
    await assertAboveMinAmount(deal);
  } catch (err) {
    if (err.code === "BELOW_MINIMUM") throw err;
    console.warn("Vérification min LTC:", err.message);
  }

  const priceCurrency = fiatCurrencyCode(deal.currency);
  const payCurrency = String(deal.crypto || "LTC").toLowerCase();
  const price = Number(deal.price);

  const payload = {
    amount: price,
    currency: priceCurrency,
    pay_currency: payCurrency,
    order_id: deal.deal_code,
    description: `Escrow deal #${deal.deal_code} — ${deal.product}`,
    lifetime: 120,
    // Critique escrow: garder les fonds sur le solde OxaPay (pas d'auto-withdraw)
    auto_withdrawal: false,
  };

  if (config.oxapayCallbackUrl) {
    payload.callback_url = config.oxapayCallbackUrl;
  }

  try {
    const data = await merchantRequest("POST", "/payment/white-label", payload);
    return {
      payment_id: String(data.track_id),
      pay_address: data.address,
      pay_amount: data.pay_amount != null ? Number(data.pay_amount) : null,
      payment_status: "waiting",
      pay_currency: data.pay_currency || payCurrency,
      price_amount: data.amount != null ? Number(data.amount) : price,
      price_currency: data.currency || priceCurrency,
      expired_at: data.expired_at || null,
      raw: data,
    };
  } catch (err) {
    const raw = String(err.message || "");
    if (/minimum|too small|min amount|below/i.test(raw)) {
      const nicer = new Error(
        `Bloqué par l'API OxaPay — montant trop bas. Minimum LTC ≈ ${LTC_MIN_AMOUNT}. Détail: ${raw}`
      );
      nicer.code = "BELOW_MINIMUM";
      throw nicer;
    }
    throw err;
  }
}

function sumConfirmedTxAmount(txs) {
  if (!Array.isArray(txs) || !txs.length) return null;
  let total = 0;
  let found = false;
  for (const tx of txs) {
    const n = Number(tx.amount);
    if (!Number.isFinite(n) || n <= 0) continue;
    const st = String(tx.status || "").toLowerCase();
    if (st === "confirmed" || st === "confirming" || !st) {
      total += n;
      found = true;
    }
  }
  return found ? total : null;
}

async function getPaymentStatus(paymentId) {
  const data = await merchantRequest("GET", `/payment/${paymentId}`);
  const paidFromTxs = sumConfirmedTxAmount(data.txs);
  const address =
    data.txs?.find((t) => t.address)?.address ||
    data.address ||
    null;

  return {
    payment_id: String(data.track_id || paymentId),
    payment_status: data.status,
    pay_address: address,
    pay_amount: paidFromTxs,
    actually_paid: paidFromTxs,
    outcome_amount: paidFromTxs,
    raw: data,
  };
}

async function getPayoutStatus(payoutId) {
  const data = await payoutRequest("GET", `/payout/${payoutId}`);
  return {
    id: String(data.track_id || payoutId),
    status: data.status,
    raw: data,
  };
}

function resolvePayoutAmount(deal, paymentDetails) {
  const candidates = [
    paymentDetails?.outcome_amount,
    paymentDetails?.actually_paid,
    paymentDetails?.pay_amount,
    deal.pay_amount,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Envoie le LTC du solde OxaPay vers l'adresse du vendeur.
 */
async function payoutToSeller(deal, paymentDetails) {
  if (!deal.seller_wallet) {
    throw new Error("Adresse LTC du vendeur manquante");
  }
  if (!isValidLtcAddress(deal.seller_wallet)) {
    throw new Error("Adresse LTC du vendeur invalide");
  }
  if (!config.oxapayPayoutApiKey) {
    throw new Error("OXAPAY_PAYOUT_API_KEY manquant dans le .env");
  }

  const amount = resolvePayoutAmount(deal, paymentDetails);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Montant crypto invalide pour le payout");
  }

  const currency = String(deal.crypto || "LTC").toUpperCase();
  const payload = {
    address: deal.seller_wallet.trim(),
    currency,
    amount,
    description: `Escrow release #${deal.deal_code}`,
  };

  if (config.oxapayCallbackUrl) {
    payload.callback_url = config.oxapayCallbackUrl;
  }

  const created = await payoutRequest("POST", "/payout", payload);
  const payoutId = String(created.track_id || "");
  const status = created.status || "processing";

  return { payoutId, status, raw: created };
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

function isPayoutDoneStatus(status) {
  return PAYOUT_DONE.has(status);
}

function isPayoutFailedStatus(status) {
  return PAYOUT_FAIL.has(status);
}

module.exports = {
  createLtcPayment,
  assertAboveMinAmount,
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  resolvePayoutAmount,
  statusLabel,
  isPaidStatus,
  isActiveStatus,
  isFailedStatus,
  isPayoutDoneStatus,
  isPayoutFailedStatus,
  isValidLtcAddress,
  fiatCurrencyCode,
  LTC_MIN_AMOUNT,
};
