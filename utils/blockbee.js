const crypto = require("crypto");
const config = require("../config");
const { fiatToLtc } = require("./ltcPrice");

const API_BASE = "https://api.blockbee.io";
const TICKER = "ltc";

/** Min LTC BlockBee (live ~0.002). Soft default; refreshed via /info when possible. */
let cachedMinLtc = 0.002;

const PAID_STATUSES = new Set(["paid", "confirmed"]);
const ACTIVE_STATUSES = new Set(["waiting", "pending"]);
const TERMINAL_FAIL_STATUSES = new Set(["expired", "error", "cancelled"]);

const PAYOUT_DONE = new Set(["done", "completed"]);
const PAYOUT_FAIL = new Set(["error", "rejected", "expired"]);

function fiatCurrencyCode(currencySymbol) {
  if (currencySymbol === "€") return "eur";
  if (currencySymbol === "$") return "usd";
  return String(currencySymbol || "usd").toLowerCase();
}

function statusLabel(status) {
  const labels = {
    waiting: "En attente de paiement",
    pending: "Confirmation blockchain",
    paid: "Paiement reçu",
    confirmed: "Paiement confirmé",
    expired: "Expiré",
    error: "Erreur",
    cancelled: "Annulé",
    created: "Payout créé",
    processing: "Payout en cours",
    done: "Payout terminé",
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

async function blockbeeRequest(method, path, { query = {}, body } = {}) {
  if (!config.blockbeeApiKey) {
    throw new Error("BLOCKBEE_API_KEY manquant dans le .env (API Key V2)");
  }

  const params = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ),
    apikey: config.blockbeeApiKey,
  });

  const url = `${API_BASE}${path}?${params.toString()}`;
  const opts = {
    method,
    headers: { Accept: "application/json" },
  };

  if (body != null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

async function refreshMinAmount() {
  try {
    const info = await blockbeeRequest("GET", `/${TICKER}/info/`);
    const min = Number(info.minimum_transaction_coin);
    if (Number.isFinite(min) && min > 0) cachedMinLtc = min;
  } catch (err) {
    console.warn("BlockBee /info min:", err.message);
  }
  return cachedMinLtc;
}

async function assertAboveMinAmount(deal) {
  await refreshMinAmount();
  const price = Number(deal.price);
  let cryptoAmount = Number(deal.pay_amount);

  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    try {
      const { cryptoAmount: estimated } = await fiatToLtc(price, deal.currency);
      cryptoAmount = estimated;
    } catch {
      return { minCrypto: cachedMinLtc, estimated: null };
    }
  }

  if (Number.isFinite(cryptoAmount) && cryptoAmount < cachedMinLtc) {
    const err = new Error(
      `Montant trop bas pour BlockBee (LTC). Minimum ≈ ${cachedMinLtc} LTC ` +
        `(~${(cachedMinLtc * (price / cryptoAmount)).toFixed(2)}${deal.currency} selon le cours). ` +
        `Ton deal: ${price}${deal.currency} ≈ ${cryptoAmount.toFixed(8)} LTC.`
    );
    err.code = "BELOW_MINIMUM";
    err.minCrypto = cachedMinLtc;
    throw err;
  }

  return { minCrypto: cachedMinLtc, estimated: cryptoAmount };
}

function buildCallbackUrl(dealCode) {
  const nonce = crypto.randomBytes(8).toString("hex");
  // URL unique d'ID pour les logs (pas besoin d'être joignable — on poll)
  return `https://escrow.local/blockbee?deal=${encodeURIComponent(dealCode)}&n=${nonce}`;
}

/**
 * Crée une adresse LTC BlockBee. Fonds forwardés vers le wallet/SCW configuré au dashboard.
 */
async function createLtcPayment(deal) {
  try {
    await assertAboveMinAmount(deal);
  } catch (err) {
    if (err.code === "BELOW_MINIMUM") throw err;
    console.warn("Min LTC check:", err.message);
  }

  const callback = buildCallbackUrl(deal.deal_code);
  const data = await blockbeeRequest("GET", `/${TICKER}/create/`, {
    query: {
      callback,
      confirmations: "1",
      pending: "1",
      json: "1",
    },
  });

  const address = data.address_in;
  if (!address) {
    throw new Error("BlockBee n'a pas renvoyé d'adresse LTC");
  }

  let payAmount = Number(deal.pay_amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    try {
      const { cryptoAmount } = await fiatToLtc(Number(deal.price), deal.currency);
      payAmount = cryptoAmount;
    } catch {
      payAmount = null;
    }
  }

  return {
    payment_id: data.callback_url || callback,
    pay_address: address,
    pay_amount: payAmount,
    payment_status: "waiting",
    pay_currency: "LTC",
    raw: data,
  };
}

function sumConfirmedFromLogs(logs) {
  const callbacks = Array.isArray(logs?.callbacks) ? logs.callbacks : [];
  let total = 0;
  let pending = 0;
  let anyConfirmed = false;
  let anyPending = false;

  for (const cb of callbacks) {
    const value = Number(cb.value_forwarded_coin ?? cb.value_coin ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const conf = Number(cb.confirmations || 0);
    const result = String(cb.result || "").toLowerCase();
    if (result === "sent" || conf >= 1) {
      total += value;
      anyConfirmed = true;
    } else {
      pending += value;
      anyPending = true;
    }
  }

  return { total, pending, anyConfirmed, anyPending };
}

async function getPaymentStatus(paymentId) {
  const logs = await blockbeeRequest("GET", `/${TICKER}/logs/`, {
    query: { callback: paymentId },
  });

  const { total, pending, anyConfirmed, anyPending } = sumConfirmedFromLogs(logs);

  let payment_status = "waiting";
  if (anyConfirmed && total > 0) payment_status = "paid";
  else if (anyPending) payment_status = "pending";

  return {
    payment_id: paymentId,
    payment_status,
    pay_address: logs.address_in || null,
    pay_amount: total > 0 ? total : pending > 0 ? pending : null,
    actually_paid: total > 0 ? total : null,
    outcome_amount: total > 0 ? total : null,
    raw: logs,
  };
}

async function getPayoutStatus(payoutId) {
  const data = await blockbeeRequest("POST", `/payout/status/`, {
    body: { payout_id: payoutId },
  });
  const info = data.payout_info || data;
  return {
    id: String(info.id || payoutId),
    status: info.status || data.status,
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
 * Envoie LTC depuis le Self-Custodial Wallet BlockBee vers le vendeur.
 */
async function payoutToSeller(deal, paymentDetails) {
  if (!deal.seller_wallet) {
    throw new Error("Adresse LTC du vendeur manquante");
  }
  if (!isValidLtcAddress(deal.seller_wallet)) {
    throw new Error("Adresse LTC du vendeur invalide");
  }

  const amount = resolvePayoutAmount(deal, paymentDetails);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Montant crypto invalide pour le payout");
  }

  const req = await blockbeeRequest("GET", `/${TICKER}/payout/request/create/`, {
    query: {
      address: deal.seller_wallet.trim(),
      value: String(amount),
    },
  });

  const requestId = req.request_id || req.id || req?.payout_request?.id;
  if (!requestId) {
    throw new Error(`Création payout request échouée: ${JSON.stringify(req)}`);
  }

  const created = await blockbeeRequest("POST", `/payout/create/`, {
    body: { request_ids: String(requestId) },
  });

  const payoutId = created.payout_info?.id || created.id;
  if (!payoutId) {
    throw new Error(`Création payout échouée: ${JSON.stringify(created)}`);
  }

  let status = created.payout_info?.status || "created";

  try {
    const processed = await blockbeeRequest("POST", `/payout/process/`, {
      body: { payout_id: String(payoutId) },
    });
    status = processed.payout_info?.status || status || "processing";
  } catch (err) {
    console.warn("BlockBee process payout:", err.message);
  }

  return { payoutId: String(payoutId), status, raw: created };
}

async function pingBlockbee() {
  return blockbeeRequest("GET", `/${TICKER}/info/`);
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
  pingBlockbee,
  LTC_MIN_AMOUNT: () => cachedMinLtc,
};
