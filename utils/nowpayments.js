const { TOTP } = require("otpauth");
const config = require("../config");

const API_BASE = "https://api.nowpayments.io/v1";

const PAID_STATUSES = new Set(["finished"]);
const ACTIVE_STATUSES = new Set(["waiting", "confirming", "confirmed", "sending", "partially_paid"]);
const TERMINAL_FAIL_STATUSES = new Set(["failed", "expired", "refunded"]);

/** JWT cache court (NOWPayments: ~5 min). */
let cachedJwt = null;
let cachedJwtExpiresAt = 0;

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
    creating: "Payout en création",
    processing: "Payout en cours",
    sending_payout: "Envoi au vendeur",
  };
  return labels[status] || status || "Inconnu";
}

/**
 * Validation basique d'une adresse Litecoin (legacy / P2SH / bech32).
 */
function isValidLtcAddress(address) {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  if (/^ltc1[a-z0-9]{25,90}$/i.test(trimmed)) return true;
  if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  return false;
}

async function nowpaymentsRequest(method, path, body, { bearer } = {}) {
  if (!config.nowpaymentsApiKey) {
    throw new Error("NOWPAYMENTS_API_KEY manquant dans le .env");
  }

  const headers = {
    "x-api-key": config.nowpaymentsApiKey,
    "Content-Type": "application/json",
  };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || JSON.stringify(data) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Auth JWT requis pour les payouts Custody.
 */
async function authenticate() {
  if (!config.nowpaymentsEmail || !config.nowpaymentsPassword) {
    throw new Error(
      "NOWPAYMENTS_EMAIL et NOWPAYMENTS_PASSWORD requis pour libérer les fonds vers le vendeur"
    );
  }

  if (cachedJwt && Date.now() < cachedJwtExpiresAt) {
    return cachedJwt;
  }

  const data = await nowpaymentsRequest("POST", "/auth", {
    email: config.nowpaymentsEmail,
    password: config.nowpaymentsPassword,
  });

  if (!data.token) {
    throw new Error("Authentification NOWPayments échouée (pas de token)");
  }

  cachedJwt = data.token;
  // Marge de sécurité: 4 minutes
  cachedJwtExpiresAt = Date.now() + 4 * 60 * 1000;
  return cachedJwt;
}

function generateTotpCode() {
  if (!config.nowpayments2faSecret) return null;
  const totp = new TOTP({
    secret: config.nowpayments2faSecret,
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

/**
 * Minimum dynamique NOWPayments pour une paire (ex: eur → ltc).
 * Doc: ~2$ pour LTC, variable selon frais réseau — non contournable côté bot.
 */
async function getMinPaymentAmount({ currencyFrom, currencyTo, fiatEquivalent, isFixedRate = true }) {
  const params = new URLSearchParams({
    currency_from: currencyFrom,
    currency_to: currencyTo,
    is_fixed_rate: String(!!isFixedRate),
  });
  if (fiatEquivalent) params.set("fiat_equivalent", fiatEquivalent);
  return nowpaymentsRequest("GET", `/min-amount?${params.toString()}`);
}

function belowMinimumError({ currency, price, minFiat, minCrypto, payCurrency }) {
  const minLabel =
    Number.isFinite(minFiat) && minFiat > 0
      ? `≈ ${minFiat.toFixed(2)}${currency}`
      : Number.isFinite(minCrypto) && minCrypto > 0
        ? `≈ ${minCrypto} ${String(payCurrency || "LTC").toUpperCase()}`
        : "le seuil NOWPayments (souvent ≈ 2$)";

  const err = new Error(
    `Bloqué par l'API NOWPayments — montant trop bas. ` +
      `Minimum actuel ${minLabel} (ton deal: ${price}${currency}). ` +
      `Le bot ne peut pas forcer un paiement en dessous de ce seuil.`
  );
  err.code = "BELOW_MINIMUM";
  err.minFiat = minFiat;
  err.minCrypto = minCrypto;
  return err;
}

/**
 * Vérifie le prix du deal contre le minimum live NOWPayments.
 * @returns {Promise<{ minFiat: number|null, minCrypto: number|null }>}
 */
async function assertAboveMinAmount(deal) {
  const priceCurrency = fiatCurrencyCode(deal.currency);
  const payCurrency = String(deal.crypto || "LTC").toLowerCase();
  const price = Number(deal.price);

  const minInfo = await getMinPaymentAmount({
    currencyFrom: priceCurrency,
    currencyTo: payCurrency,
    fiatEquivalent: priceCurrency,
    isFixedRate: true,
  });

  const minCrypto = Number(minInfo.min_amount);
  const minFiat = Number(minInfo.fiat_equivalent);

  if (Number.isFinite(minFiat) && minFiat > 0 && price < minFiat) {
    throw belowMinimumError({
      currency: deal.currency,
      price,
      minFiat,
      minCrypto,
      payCurrency,
    });
  }

  return {
    minFiat: Number.isFinite(minFiat) ? minFiat : null,
    minCrypto: Number.isFinite(minCrypto) ? minCrypto : null,
  };
}

/**
 * Crée un paiement LTC via NOWPayments pour un deal.
 */
async function createLtcPayment(deal) {
  const priceCurrency = fiatCurrencyCode(deal.currency);
  const payCurrency = String(deal.crypto || "LTC").toLowerCase();
  const price = Number(deal.price);

  try {
    await assertAboveMinAmount(deal);
  } catch (err) {
    if (err.code === "BELOW_MINIMUM") throw err;
    console.warn("Vérification min-amount impossible:", err.message);
  }

  const payload = {
    price_amount: price,
    price_currency: priceCurrency,
    pay_currency: payCurrency,
    order_id: deal.deal_code,
    order_description: `Escrow deal #${deal.deal_code} — ${deal.product}`,
    is_fixed_rate: true,
  };

  if (config.nowpaymentsIpnUrl) {
    payload.ipn_callback_url = config.nowpaymentsIpnUrl;
  }

  try {
    return await nowpaymentsRequest("POST", "/payment", payload);
  } catch (err) {
    const raw = String(err.message || "");
    if (/amountTo is too small|too small|minimum/i.test(raw)) {
      let minFiat = null;
      let minCrypto = null;
      try {
        const minInfo = await getMinPaymentAmount({
          currencyFrom: priceCurrency,
          currencyTo: payCurrency,
          fiatEquivalent: priceCurrency,
          isFixedRate: true,
        });
        minFiat = Number(minInfo.fiat_equivalent);
        minCrypto = Number(minInfo.min_amount);
      } catch {
        // ignore — on affiche quand même le refus API
      }
      throw belowMinimumError({
        currency: deal.currency,
        price,
        minFiat,
        minCrypto,
        payCurrency,
      });
    }
    throw err;
  }
}

async function getPaymentStatus(paymentId) {
  return nowpaymentsRequest("GET", `/payment/${paymentId}`);
}

async function getPayoutStatus(payoutId) {
  const token = await authenticate();
  return nowpaymentsRequest("GET", `/payout/${payoutId}`, null, { bearer: token });
}

/**
 * Montant LTC réellement à envoyer au vendeur (préfère le montant reçu).
 */
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
 * Envoie le LTC du Custody vers l'adresse du vendeur.
 * @returns {{ payoutId: string, status: string, raw: object, warning?: string }}
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

  const token = await authenticate();
  const currency = String(deal.crypto || "LTC").toLowerCase();

  const payload = {
    withdrawals: [
      {
        address: deal.seller_wallet.trim(),
        currency,
        amount,
        unique_id: `escrow-${deal.deal_code}-${Date.now()}`,
      },
    ],
  };

  if (config.nowpaymentsIpnUrl) {
    payload.ipn_callback_url = config.nowpaymentsIpnUrl;
  }

  const created = await nowpaymentsRequest("POST", "/payout", payload, { bearer: token });
  const payoutId = String(created.id || created.batch_withdrawal_id || "");
  let status = created.withdrawals?.[0]?.status || created.status || "creating";

  const totpCode = generateTotpCode();
  if (payoutId && totpCode) {
    try {
      const freshToken = await authenticate();
      await nowpaymentsRequest(
        "POST",
        `/payout/${payoutId}/verify`,
        { verification_code: totpCode },
        { bearer: freshToken }
      );
      status = "processing";
    } catch (err) {
      console.error(`Vérification 2FA payout #${payoutId}:`, err.message);
      return {
        payoutId,
        status: "awaiting_2fa",
        raw: created,
        warning: err.message,
      };
    }
  } else if (payoutId && !totpCode) {
    status = status === "creating" || status === "waiting" ? "awaiting_2fa" : status;
  }

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

module.exports = {
  createLtcPayment,
  getMinPaymentAmount,
  assertAboveMinAmount,
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  authenticate,
  resolvePayoutAmount,
  statusLabel,
  isPaidStatus,
  isActiveStatus,
  isFailedStatus,
  isValidLtcAddress,
  fiatCurrencyCode,
};
