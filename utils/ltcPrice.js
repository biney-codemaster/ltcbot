/**
 * Récupère le prix LTC et convertit un montant fiat (€ ou $) en Litecoin.
 * Source: CoinGecko (pas de clé API requise).
 */

async function fetchLtcPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=eur,usd";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}`);
  }
  const data = await res.json();
  const eur = data?.litecoin?.eur;
  const usd = data?.litecoin?.usd;
  if (!Number.isFinite(eur) || !Number.isFinite(usd)) {
    throw new Error("Prix LTC invalide depuis CoinGecko");
  }
  return { eur, usd };
}

/**
 * Convertit un prix fiat vers LTC.
 * @param {number} price
 * @param {'€'|'$'} currency
 */
async function fiatToLtc(price, currency) {
  const rates = await fetchLtcPrices();
  const rate = currency === "€" ? rates.eur : rates.usd;
  return { cryptoAmount: price / rate, rate };
}

/** Formate un montant LTC (jusqu'à 8 décimales, sans zéros inutiles). */
function formatLtcAmount(amount) {
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(8).replace(/\.?0+$/, "");
}

module.exports = { fetchLtcPrices, fiatToLtc, formatLtcAmount };
