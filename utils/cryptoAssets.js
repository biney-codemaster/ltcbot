/**
 * Cryptos supportées pour l'escrow Nestoo.
 * Chaque entrée pilote le menu Discord, les labels UI et le routage wallet.
 */

const CRYPTO_ASSETS = {
  LTC: {
    code: "LTC",
    name: "Litecoin",
    label: "Litecoin (LTC)",
    description: "Pay with Litecoin",
    decimals: 8,
    emojiKey: "ltc",
    networkFeesLabel: "Litecoin network fees",
    addressPlaceholder: "ltc1… / L… / M…",
    addressHint: "Litecoin address (L… / M… / ltc1…)",
  },
  BTC: {
    code: "BTC",
    name: "Bitcoin",
    label: "Bitcoin (BTC)",
    description: "Pay with Bitcoin",
    decimals: 8,
    emojiKey: "btc",
    networkFeesLabel: "Bitcoin network fees",
    addressPlaceholder: "bc1… / 1… / 3…",
    addressHint: "Bitcoin address (bc1… / 1… / 3…)",
  },
  ETH: {
    code: "ETH",
    name: "Ethereum",
    label: "Ethereum (ETH)",
    description: "Pay with Ethereum",
    decimals: 18,
    emojiKey: "eth",
    networkFeesLabel: "Ethereum network fees",
    addressPlaceholder: "0x…",
    addressHint: "Ethereum address (0x…)",
  },
  SOL: {
    code: "SOL",
    name: "Solana",
    label: "Solana (SOL)",
    description: "Pay with Solana",
    decimals: 9,
    emojiKey: "sol",
    networkFeesLabel: "Solana network fees",
    addressPlaceholder: "Base58 address…",
    addressHint: "Solana address (Base58)",
  },
};

const SUPPORTED_CRYPTOS = Object.keys(CRYPTO_ASSETS);

function normalizeCrypto(code) {
  const raw = String(code || "LTC").trim().toUpperCase();
  return CRYPTO_ASSETS[raw] ? raw : null;
}

function getCryptoAsset(code) {
  const key = normalizeCrypto(code) || "LTC";
  return CRYPTO_ASSETS[key];
}

function isSupportedCrypto(code) {
  return Boolean(normalizeCrypto(code));
}

module.exports = {
  CRYPTO_ASSETS,
  SUPPORTED_CRYPTOS,
  normalizeCrypto,
  getCryptoAsset,
  isSupportedCrypto,
};
