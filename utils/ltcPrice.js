/**
 * Prix LTC multi-sources (médiane) → conversion fiat → Litecoin.
 * Sources : Coinbase, Kraken, CoinGecko (fallback).
 */

const CACHE_TTL_MS = 30_000;
/** @type {{ at: number, eur: number, usd: number, sources: string[] } | null} */
let cache = null;

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

async function fromCoinbase() {
  const data = await fetchJson("https://api.coinbase.com/v2/exchange-rates?currency=LTC");
  const eur = Number(data?.data?.rates?.EUR);
  const usd = Number(data?.data?.rates?.USD);
  if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
    throw new Error("Coinbase invalide");
  }
  return { eur, usd, source: "coinbase" };
}

async function fromKraken() {
  const data = await fetchJson(
    "https://api.kraken.com/0/public/Ticker?pair=XLTCZEUR,XLTCZUSD"
  );
  const eur = Number(data?.result?.XLTCZEUR?.c?.[0]);
  const usd = Number(data?.result?.XLTCZUSD?.c?.[0]);
  if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
    throw new Error("Kraken invalide");
  }
  return { eur, usd, source: "kraken" };
}

async function fromCoinGecko() {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=eur,usd"
  );
  const eur = Number(data?.litecoin?.eur);
  const usd = Number(data?.litecoin?.usd);
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

/**
 * Récupère le cours LTC/EUR et LTC/USD (médiane multi-sources).
 */
async function fetchLtcPrices({ bypassCache = false } = {}) {
  if (!bypassCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { eur: cache.eur, usd: cache.usd, sources: cache.sources };
  }

  const results = await Promise.allSettled([fromCoinbase(), fromKraken(), fromCoinGecko()]);
  const ok = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  if (ok.length === 0) {
    const errs = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || "err")
      .join("; ");
    throw new Error(`Impossible de récupérer le cours LTC (${errs})`);
  }

  const eur = median(ok.map((r) => r.eur));
  const usd = median(ok.map((r) => r.usd));
  const sources = ok.map((r) => r.source);

  cache = { at: Date.now(), eur, usd, sources };
  return { eur, usd, sources };
}

/** Arrondi LTC à 8 décimales (unité on-chain). */
function roundLtc(amount) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 1e8) / 1e8;
}

/**
 * Convertit un prix fiat vers LTC au cours live.
 * @param {number} price
 * @param {'€'|'$'} currency
 */
async function fiatToLtc(price, currency, { bypassCache = false } = {}) {
  const rates = await fetchLtcPrices({ bypassCache });
  const rate = currency === "€" ? rates.eur : rates.usd;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Taux LTC invalide");
  }
  const cryptoAmount = roundLtc(Number(price) / rate);
  if (cryptoAmount == null || cryptoAmount <= 0) {
    throw new Error("Montant LTC invalide après conversion");
  }
  return {
    cryptoAmount,
    rate,
    fiatCurrency: currency === "€" ? "EUR" : "USD",
    sources: rates.sources,
  };
}

/** Formate un montant LTC (jusqu'à 8 décimales, sans zéros inutiles). */
function formatLtcAmount(amount) {
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(8).replace(/\.?0+$/, "");
}

/** Affiche le cours utilisé, ex: `1 LTC = 39.50€`. */
function formatLtcRate(rate, currency) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const sym = currency === "$" ? "$" : "€";
  return `1 LTC = ${rate.toFixed(2)}${sym}`;
}

module.exports = {
  fetchLtcPrices,
  fiatToLtc,
  formatLtcAmount,
  formatLtcRate,
  roundLtc,
};
