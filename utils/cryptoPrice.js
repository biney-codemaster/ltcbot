/**
 * Conversion fiat → crypto multi-assets (médiane multi-sources).
 */

const { getCryptoAsset } = require("./cryptoAssets");

const CACHE_TTL_MS = 30_000;

/** @type {Map<string, { at: number, eur: number, usd: number, sources: string[] }>} */
const cacheByAsset = new Map();

const COINGECKO_IDS = {
  LTC: "litecoin",
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

const COINBASE_CURRENCY = {
  LTC: "LTC",
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
};

const KRAKEN_PAIRS = {
  LTC: { eur: "XLTCZEUR", usd: "XLTCZUSD" },
  BTC: { eur: "XXBTZEUR", usd: "XXBTZUSD" },
  ETH: { eur: "XETHZEUR", usd: "XETHZUSD" },
  SOL: { eur: "SOLEUR", usd: "SOLUSD" },
};

async function fetchJson(url, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fromCoinbase(crypto) {
  const currency = COINBASE_CURRENCY[crypto];
  const data = await fetchJson(
    `https://api.coinbase.com/v2/exchange-rates?currency=${currency}`
  );
  const eur = Number(data?.data?.rates?.EUR);
  const usd = Number(data?.data?.rates?.USD);
  if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
    throw new Error("Coinbase invalide");
  }
  return { eur, usd, source: "coinbase" };
}

async function fromKraken(crypto) {
  const pairs = KRAKEN_PAIRS[crypto];
  if (!pairs) throw new Error("Kraken pair manquante");
  const data = await fetchJson(
    `https://api.kraken.com/0/public/Ticker?pair=${pairs.eur},${pairs.usd}`
  );
  const result = data?.result || {};
  const eurKey = Object.keys(result).find((k) => k.includes("EUR") || k === pairs.eur) || pairs.eur;
  const usdKey = Object.keys(result).find((k) => k.includes("USD") || k === pairs.usd) || pairs.usd;
  const eur = Number(result[eurKey]?.c?.[0]);
  const usd = Number(result[usdKey]?.c?.[0]);
  if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
    throw new Error("Kraken invalide");
  }
  return { eur, usd, source: "kraken" };
}

async function fromCoinGecko(crypto) {
  const id = COINGECKO_IDS[crypto];
  const data = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur,usd`
  );
  const eur = Number(data?.[id]?.eur);
  const usd = Number(data?.[id]?.usd);
  if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
    throw new Error("CoinGecko invalide");
  }
  return { eur, usd, source: "coingecko" };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

async function fetchCryptoPrices(crypto, { bypassCache = false } = {}) {
  const code = String(crypto || "LTC").toUpperCase();
  if (!COINGECKO_IDS[code]) {
    throw new Error(`Crypto non supportée pour les prix: ${code}`);
  }

  const cached = cacheByAsset.get(code);
  if (!bypassCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { eur: cached.eur, usd: cached.usd, sources: cached.sources };
  }

  const results = await Promise.allSettled([
    fromCoinbase(code),
    fromKraken(code),
    fromCoinGecko(code),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);

  if (ok.length === 0) {
    const errs = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || "err")
      .join("; ");
    throw new Error(`Impossible de récupérer le cours ${code} (${errs})`);
  }

  const eur = median(ok.map((r) => r.eur));
  const usd = median(ok.map((r) => r.usd));
  const sources = ok.map((r) => r.source);
  cacheByAsset.set(code, { at: Date.now(), eur, usd, sources });
  return { eur, usd, sources };
}

function roundCrypto(amount, decimals) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}

/**
 * Convertit un prix fiat vers la crypto choisie.
 * @param {number} price
 * @param {'€'|'$'} currency
 * @param {string} crypto
 */
async function fiatToCrypto(price, currency, crypto = "LTC", { bypassCache = false } = {}) {
  const asset = getCryptoAsset(crypto);
  const rates = await fetchCryptoPrices(asset.code, { bypassCache });
  const rate = currency === "€" ? rates.eur : rates.usd;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Taux ${asset.code} invalide`);
  }
  const cryptoAmount = roundCrypto(Number(price) / rate, asset.decimals);
  if (cryptoAmount == null || cryptoAmount <= 0) {
    throw new Error(`Montant ${asset.code} invalide après conversion`);
  }
  return {
    cryptoAmount,
    rate,
    fiatCurrency: currency === "€" ? "EUR" : "USD",
    sources: rates.sources,
    crypto: asset.code,
  };
}

/** Formate un montant crypto (sans zéros inutiles). */
function formatCryptoAmount(amount, crypto = "LTC") {
  if (!Number.isFinite(Number(amount))) return null;
  const decimals = getCryptoAsset(crypto).decimals;
  // Affichage max 8 décimales pour ETH (18 on-chain) pour rester lisible
  const displayDecimals = Math.min(decimals, 8);
  return Number(amount)
    .toFixed(displayDecimals)
    .replace(/\.?0+$/, "");
}

function formatCryptoRate(rate, currency, crypto = "LTC") {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const sym = currency === "$" ? "$" : "€";
  const code = getCryptoAsset(crypto).code;
  return `1 ${code} = ${rate.toFixed(2)}${sym}`;
}

// --- Compat LTC ---
async function fiatToLtc(price, currency, opts) {
  return fiatToCrypto(price, currency, "LTC", opts);
}

function formatLtcAmount(amount) {
  return formatCryptoAmount(amount, "LTC");
}

function formatLtcRate(rate, currency) {
  return formatCryptoRate(rate, currency, "LTC");
}

async function fetchLtcPrices(opts) {
  return fetchCryptoPrices("LTC", opts);
}

function roundLtc(amount) {
  return roundCrypto(amount, 8);
}

module.exports = {
  fetchCryptoPrices,
  fiatToCrypto,
  formatCryptoAmount,
  formatCryptoRate,
  roundCrypto,
  // compat
  fetchLtcPrices,
  fiatToLtc,
  formatLtcAmount,
  formatLtcRate,
  roundLtc,
};
