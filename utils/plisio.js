const config = require("../config");

const API_BASE = "https://api.plisio.net/api/v1";

/** Plisio invoice min LTC (quasi dust). Soft-check très bas. */
const LTC_MIN_AMOUNT = 0.0000001;

const PAID_STATUSES = new Set(["completed", "mismatch"]);
const ACTIVE_STATUSES = new Set(["new", "pending", "pending internal"]);
const TERMINAL_FAIL_STATUSES = new Set([
  "expired",
  "error",
  "cancelled",
  "cancelled duplicate",
]);

const PAYOUT_DONE = new Set(["completed"]);
const PAYOUT_FAIL = new Set(["error"]);

function fiatCurrencyCode(currencySymbol) {
  if (currencySymbol === "€") return "EUR";
  if (currencySymbol === "$") return "USD";
  return String(currencySymbol || "USD").toUpperCase();
}

function statusLabel(status) {
  const labels = {
    new: "En attente de paiement",
    pending: "Confirmation blockchain",
    "pending internal": "Crédit du solde Plisio",
    completed: "Paiement reçu",
    mismatch: "Paiement reçu (surplus)",
    expired: "Expiré",
    error: "Erreur",
    cancelled: "Annulé",
    "cancelled duplicate": "Annulé (doublon)",
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
  const msg = data.data?.message ?? data.message;
  if (typeof msg === "string") return msg;
  if (msg && typeof msg === "object") return JSON.stringify(msg);
  if (data.data?.name) return data.data.name;
  return fallback;
}

async function plisioGet(path, params = {}) {
  if (!config.plisioApiKey) {
    throw new Error("PLISIO_API_KEY manquant dans le .env");
  }

  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ),
    api_key: config.plisioApiKey,
  });

  const res = await fetch(`${API_BASE}${path}?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") {
    const raw = extractErrorMessage(data, `HTTP ${res.status}`);
    if (/secret key|domain is verified/i.test(raw)) {
      throw new Error(
        `${raw} — Checks: 1) PLISIO_API_KEY = Secret key du shop (Site Settings), sans guillemets/espaces 2) champ IP Plisio VIDE (sur Pterodactyl l'IP panel ≠ IP sortie) 3) redémarrer le bot après .env 4) shop sauvegardé + White-label`
      );
    }
    throw new Error(raw);
  }
  return data.data !== undefined ? data.data : data;
}

/** Ping API au démarrage pour valider la clé rapidement. */
async function pingPlisio() {
  return plisioGet("/currencies");
}

/**
 * Soft-check (quasi jamais bloquant chez Plisio).
 */
async function assertAboveMinAmount(deal) {
  const price = Number(deal.price);
  const cryptoAmount = Number(deal.pay_amount);
  if (Number.isFinite(cryptoAmount) && cryptoAmount > 0 && cryptoAmount < LTC_MIN_AMOUNT) {
    const err = new Error(
      `Montant trop bas pour Plisio (LTC). Minimum ≈ ${LTC_MIN_AMOUNT} LTC ` +
        `(deal: ${price}${deal.currency}).`
    );
    err.code = "BELOW_MINIMUM";
    err.minCrypto = LTC_MIN_AMOUNT;
    throw err;
  }
  return { minCrypto: LTC_MIN_AMOUNT };
}

/**
 * Crée une invoice LTC white-label. Fonds crédités sur le solde Plisio.
 */
async function createLtcPayment(deal) {
  const sourceCurrency = fiatCurrencyCode(deal.currency);
  const payCurrency = String(deal.crypto || "LTC").toUpperCase();
  const price = Number(deal.price);

  const params = {
    source_currency: sourceCurrency,
    source_amount: String(price),
    currency: payCurrency,
    order_number: deal.deal_code,
    order_name: `Escrow #${deal.deal_code}`,
    description: `Escrow deal #${deal.deal_code} — ${deal.product}`,
    email: `deal-${deal.deal_code}@escrow.local`,
    expire_min: "120",
  };

  if (config.plisioCallbackUrl) {
    const base = config.plisioCallbackUrl;
    params.callback_url = base.includes("json=")
      ? base
      : `${base}${base.includes("?") ? "&" : "?"}json=true`;
  }

  try {
    const data = await plisioGet("/invoices/new", params);

    const payAmount = Number(
      data.invoice_total_sum ?? data.amount ?? data.invoice_sum ?? deal.pay_amount
    );
    const payAddress = data.wallet_hash || data.invoice_url || null;

    if (!payAddress) {
      throw new Error(
        "Plisio n'a pas renvoyé d'adresse. Active le White-label dans API » Shop settings."
      );
    }

    return {
      payment_id: String(data.txn_id),
      pay_address: payAddress,
      pay_amount: Number.isFinite(payAmount) ? payAmount : null,
      payment_status: data.status || "new",
      pay_currency: data.currency || payCurrency,
      invoice_url: data.invoice_url || null,
      raw: data,
    };
  } catch (err) {
    const raw = String(err.message || "");
    if (/minimum|too small|min amount|below/i.test(raw)) {
      const nicer = new Error(
        `Bloqué par l'API Plisio — montant trop bas. Détail: ${raw}`
      );
      nicer.code = "BELOW_MINIMUM";
      throw nicer;
    }
    throw err;
  }
}

async function getPaymentStatus(paymentId) {
  const data = await plisioGet(`/operations/${paymentId}`);
  const paidAmount = Number(
    data.actual_sum ?? data.amount ?? data.params?.amount ?? null
  );

  return {
    payment_id: String(data.id || paymentId),
    payment_status: data.status,
    pay_address: data.wallet_hash || null,
    pay_amount: Number.isFinite(paidAmount) && paidAmount > 0 ? paidAmount : null,
    actually_paid: Number.isFinite(paidAmount) && paidAmount > 0 ? paidAmount : null,
    outcome_amount: Number.isFinite(paidAmount) && paidAmount > 0 ? paidAmount : null,
    raw: data,
  };
}

async function getPayoutStatus(payoutId) {
  const data = await plisioGet(`/operations/${payoutId}`);
  return {
    id: String(data.id || payoutId),
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
 * Envoie le LTC du solde Plisio vers l'adresse du vendeur (cash_out).
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

  const currency = String(deal.crypto || "LTC").toUpperCase();
  const created = await plisioGet("/operations/withdraw", {
    currency,
    type: "cash_out",
    to: deal.seller_wallet.trim(),
    amount: String(amount),
    feePlan: "normal",
  });

  return {
    payoutId: String(created.id || ""),
    status: created.status || "pending",
    raw: created,
  };
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
  pingPlisio,
  LTC_MIN_AMOUNT,
};
