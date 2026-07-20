/**
 * Facade multi-crypto : route vers LTC / BTC / ETH / SOL selon deal.crypto.
 */

const ltc = require("./ltcWallet");
const { normalizeCrypto, getCryptoAsset, SUPPORTED_CRYPTOS, isSupportedCrypto } = require("./cryptoAssets");
const {
  fiatToCrypto,
  formatCryptoAmount,
  formatCryptoRate,
  fiatToLtc,
  formatLtcAmount,
} = require("./cryptoPrice");
const { loadOrCreateMnemonic } = require("./sharedMnemonic");
const { e, emojis } = require("../config");

/** Lazy-load heavy / ESM-sensitive adapters so the bot can boot even if one chain dep fails. */
const adapterCache = { LTC: ltc };

function loadAdapter(code) {
  if (adapterCache[code]) return adapterCache[code];
  try {
    if (code === "BTC") adapterCache.BTC = require("./btcWallet");
    else if (code === "ETH") adapterCache.ETH = require("./ethWallet");
    else if (code === "SOL") adapterCache.SOL = require("./solWallet");
    else throw new Error(`Unsupported crypto wallet: ${code}`);
  } catch (err) {
    const wrapped = new Error(
      `${code} wallet unavailable: ${err.message}. Reinstall deps or check HostMaster Node/CJS compatibility.`
    );
    wrapped.cause = err;
    throw wrapped;
  }
  return adapterCache[code];
}

function getAdapter(crypto) {
  const code = normalizeCrypto(crypto) || "LTC";
  return { code, adapter: loadAdapter(code) };
}

function dealCrypto(deal) {
  return normalizeCrypto(deal?.crypto) || "LTC";
}

async function createPayment(deal) {
  const { code, adapter } = getAdapter(dealCrypto(deal));
  if (code === "LTC") return adapter.createLtcPayment(deal);
  if (code === "BTC") return adapter.createBtcPayment(deal);
  if (code === "ETH") return adapter.createEthPayment(deal);
  if (code === "SOL") return adapter.createSolPayment(deal);
  return adapter.createPayment(deal);
}

async function getPaymentStatus(dealOrPaymentId, maybeCrypto) {
  // Support legacy: getPaymentStatus(paymentId) for LTC-only callers
  if (typeof dealOrPaymentId === "string" || dealOrPaymentId == null) {
    const paymentId = String(dealOrPaymentId || "");
    if (paymentId.startsWith("hd:btc:")) return loadAdapter("BTC").getPaymentStatus(paymentId);
    if (paymentId.startsWith("hd:eth:")) return loadAdapter("ETH").getPaymentStatus(paymentId);
    if (paymentId.startsWith("hd:sol:")) return loadAdapter("SOL").getPaymentStatus(paymentId);
    return ltc.getPaymentStatus(paymentId);
  }

  const deal = dealOrPaymentId;
  const crypto = maybeCrypto || dealCrypto(deal);
  const { adapter } = getAdapter(crypto);
  return adapter.getPaymentStatus(deal.payment_id);
}

async function getPayoutStatus(dealOrPayoutId, maybeCrypto) {
  if (dealOrPayoutId && typeof dealOrPayoutId === "object") {
    const deal = dealOrPayoutId;
    const { adapter } = getAdapter(maybeCrypto || dealCrypto(deal));
    return adapter.getPayoutStatus(deal.payout_id);
  }
  const payoutId = String(dealOrPayoutId || "");
  if (maybeCrypto) {
    const { adapter } = getAdapter(maybeCrypto);
    return adapter.getPayoutStatus(payoutId);
  }
  // Legacy string-only call (LTC deals)
  return ltc.getPayoutStatus(payoutId);
}

async function payoutToSeller(deal) {
  const { adapter } = getAdapter(dealCrypto(deal));
  return adapter.payoutToSeller(deal);
}

async function refundToBuyer(deal, buyerAddress) {
  const { adapter } = getAdapter(dealCrypto(deal));
  return adapter.refundToBuyer(deal, buyerAddress);
}

async function findBuyerRefundAddress(deal) {
  const { adapter } = getAdapter(dealCrypto(deal));
  return adapter.findBuyerRefundAddress(deal);
}

async function sweepToOwnerWallet(deal) {
  const { adapter } = getAdapter(dealCrypto(deal));
  return adapter.sweepToOwnerWallet(deal);
}

function comparePaymentAmount(deal, receivedAmount) {
  const { adapter } = getAdapter(dealCrypto(deal));
  return adapter.comparePaymentAmount(deal, receivedAmount);
}

function isValidAddress(cryptoOrAddress, maybeAddress) {
  // isValidAddress(address) → LTC legacy
  // isValidAddress(crypto, address)
  if (maybeAddress === undefined) {
    return ltc.isValidLtcAddress(cryptoOrAddress);
  }
  const { adapter } = getAdapter(cryptoOrAddress);
  if (typeof adapter.isValidAddress === "function") {
    return adapter.isValidAddress(maybeAddress);
  }
  if (typeof adapter.isValidLtcAddress === "function") {
    return adapter.isValidLtcAddress(maybeAddress);
  }
  return false;
}

function getOwnerWallet(crypto) {
  const { code, adapter } = getAdapter(crypto);
  if (code === "LTC") return adapter.getOwnerLtcWallet();
  return adapter.getOwnerWallet();
}

function getExplorerTxUrl(cryptoOrTxid, maybeTxid) {
  if (maybeTxid === undefined) {
    return ltc.getExplorerTxUrl(cryptoOrTxid);
  }
  const { adapter } = getAdapter(cryptoOrTxid);
  return adapter.getExplorerTxUrl(maybeTxid);
}

function cryptoEmojiKey(crypto) {
  const asset = getCryptoAsset(crypto);
  if (emojis[asset.emojiKey]) return asset.emojiKey;
  if (emojis.crypto) return "crypto";
  if (emojis.ltc) return "ltc";
  return "money";
}

function cryptoEmoji(crypto) {
  return e(cryptoEmojiKey(crypto));
}

function addressPlaceholder(crypto) {
  return getCryptoAsset(crypto).addressPlaceholder;
}

function addressHint(crypto) {
  return getCryptoAsset(crypto).addressHint;
}

function networkFeesLabel(crypto) {
  return getCryptoAsset(crypto).networkFeesLabel;
}

function networkName(crypto) {
  return getCryptoAsset(crypto).name;
}

async function pingWallets() {
  const results = {};
  for (const code of SUPPORTED_CRYPTOS) {
    try {
      const adapter = loadAdapter(code);
      // eslint-disable-next-line no-await-in-loop
      results[code] = await adapter.pingWallet();
    } catch (err) {
      results[code] = { ok: false, error: err.message };
    }
  }
  return results;
}

async function pingWallet() {
  // Primary probe stays LTC for bootstrap compatibility
  return ltc.pingWallet();
}

async function findFundingTxid(deal) {
  const { code, adapter } = getAdapter(dealCrypto(deal));
  if (typeof adapter.findFundingTxid === "function") {
    return adapter.findFundingTxid(deal);
  }
  if (code === "LTC") return ltc.findFundingTxid(deal);
  return null;
}

module.exports = {
  SUPPORTED_CRYPTOS,
  isSupportedCrypto,
  getCryptoAsset,
  normalizeCrypto,
  createPayment,
  createLtcPayment: (...args) => createPayment(...args),
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  refundToBuyer,
  findBuyerRefundAddress,
  findFundingTxid,
  sweepToOwnerWallet,
  comparePaymentAmount,
  isValidAddress,
  isValidLtcAddress: ltc.isValidLtcAddress,
  getOwnerWallet,
  getOwnerLtcWallet: ltc.getOwnerLtcWallet,
  getExplorerTxUrl,
  pingWallet,
  pingWallets,
  loadOrCreateMnemonic,
  statusLabel: ltc.statusLabel,
  isPaidStatus: ltc.isPaidStatus,
  isActiveStatus: ltc.isActiveStatus,
  isFailedStatus: ltc.isFailedStatus,
  isPayoutDoneStatus: ltc.isPayoutDoneStatus,
  isPayoutFailedStatus: ltc.isPayoutFailedStatus,
  resolvePayoutAmount: ltc.resolvePayoutAmount,
  assertAboveMinAmount: ltc.assertAboveMinAmount,
  fiatToCrypto,
  fiatToLtc,
  formatCryptoAmount,
  formatLtcAmount,
  formatCryptoRate,
  cryptoEmoji,
  cryptoEmojiKey,
  addressPlaceholder,
  addressHint,
  networkFeesLabel,
  networkName,
};
