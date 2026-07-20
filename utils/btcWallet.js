const fs = require("fs");
const path = require("path");
const bitcoin = require("bitcoinjs-lib");
const { BIP32Factory } = require("bip32");
const { ECPairFactory } = require("ecpair");
const ecc = require("tiny-secp256k1");
const db = require("../database");
const { loadOrCreateMnemonic } = require("./sharedMnemonic");
const { fiatToCrypto } = require("./cryptoPrice");

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const NETWORK = bitcoin.networks.bitcoin;
const EXPLORER_BASE = "https://mempool.space/api";
const ACCOUNT_PATH = "m/84'/0'/0'/0";
const DUST_SATS = 546n;
const DEFAULT_FEE_RATE = 2;
const INDEX_FILE = path.join(__dirname, "..", "wallet.next_index_btc");
const INDEX_KEY = "next_index_btc";
const DEAL_CRYPTO = "BTC";
const MAX_USED_SKIP = 200;

let rootNode = null;

function statusLabel(status) {
  const labels = {
    waiting: "Awaiting payment",
    pending: "Blockchain confirmation",
    underpaid: "Partial payment",
    paid: "Payment received",
    expired: "Expired",
    error: "Error",
    cancelled: "Cancelled",
    processing: "Payout broadcast",
    confirming: "Payout confirming",
    confirmed: "Payout confirmed",
    failed: "Payout failed",
  };
  return labels[status] || status || "Unknown";
}

function isValidAddress(address) {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  if (/^bc1[a-z0-9]{25,90}$/i.test(trimmed)) return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  return false;
}

function getRoot() {
  if (rootNode) return rootNode;
  const mnemonic = loadOrCreateMnemonic();
  const seed = require("bip39").mnemonicToSeedSync(mnemonic);
  rootNode = bip32.fromSeed(seed, NETWORK);
  return rootNode;
}

function deriveChild(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) {
    throw new Error(`Invalid BTC wallet index: ${index}`);
  }
  return getRoot().derivePath(`${ACCOUNT_PATH}/${i}`);
}

function addressFromIndex(index) {
  const child = deriveChild(index);
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: NETWORK,
  });
  if (!payment.address) throw new Error("Failed to derive BTC address");
  return { address: payment.address, payment, child };
}

function ensureWalletTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  try {
    db.exec(`ALTER TABLE deals ADD COLUMN wallet_index INTEGER`);
  } catch {
    // already present
  }
}

function readIndexFile() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return 0;
    const n = Number(fs.readFileSync(INDEX_FILE, "utf8").trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeIndexFile(index) {
  try {
    fs.writeFileSync(INDEX_FILE, `${Math.max(0, Math.floor(index))}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn("wallet.next_index_btc:", err.message);
  }
}

function peekNextWalletIndex() {
  ensureWalletTables();
  const row = db.prepare(`SELECT value FROM wallet_meta WHERE key = ?`).get(INDEX_KEY);
  const fromMeta = Number(row?.value);
  const maxDeal = db
    .prepare(`SELECT MAX(wallet_index) AS m FROM deals WHERE crypto = ? AND wallet_index IS NOT NULL`)
    .get(DEAL_CRYPTO);
  const fromDeals = Number(maxDeal?.m);
  return Math.max(
    0,
    Number.isFinite(fromMeta) ? fromMeta : 0,
    Number.isFinite(fromDeals) ? fromDeals + 1 : 0,
    readIndexFile()
  );
}

function commitWalletIndex(nextAfter) {
  ensureWalletTables();
  const v = String(Math.max(0, Math.floor(nextAfter)));
  db.prepare(
    `INSERT INTO wallet_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key: INDEX_KEY, value: v });
  writeIndexFile(nextAfter);
}

function allocateWalletIndex() {
  const next = peekNextWalletIndex();
  commitWalletIndex(next + 1);
  return next;
}

function addressHasHistory(info) {
  const chain = info?.chain_stats || {};
  const mempool = info?.mempool_stats || {};
  const counts =
    Number(chain.funded_txo_count || 0) +
    Number(chain.spent_txo_count || 0) +
    Number(mempool.funded_txo_count || 0) +
    Number(mempool.spent_txo_count || 0);
  const sums =
    Number(chain.funded_txo_sum || 0) +
    Number(chain.spent_txo_sum || 0) +
    Number(mempool.funded_txo_sum || 0) +
    Number(mempool.spent_txo_sum || 0);
  return counts > 0 || sums > 0;
}

async function allocateFreshAddress() {
  for (let attempt = 0; attempt < MAX_USED_SKIP; attempt += 1) {
    const index = allocateWalletIndex();
    const { address } = addressFromIndex(index);
    try {
      // eslint-disable-next-line no-await-in-loop
      const info = await explorerGet(`/address/${encodeURIComponent(address)}`);
      if (addressHasHistory(info)) {
        console.warn(`[wallet:btc] skip used address index=${index} ${address}`);
        continue;
      }
    } catch (err) {
      console.warn(`[wallet:btc] address history check failed index=${index}: ${err.message}`);
    }
    return { index, address };
  }
  throw new Error("Unable to find a fresh BTC address.");
}

function parsePaymentId(paymentId) {
  const raw = String(paymentId || "");
  const match = raw.match(/^hd:btc:(\d+)$/i);
  if (!match) return null;
  return Number(match[1]);
}

async function explorerGet(pathname) {
  const res = await fetch(`${EXPLORER_BASE}${pathname}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BTC explorer HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function explorerPostTx(rawHex) {
  const res = await fetch(`${EXPLORER_BASE}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawHex,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BTC broadcast failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return text.trim();
}

function btcToSats(btc) {
  const n = Number(btc);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1e8));
}

function satsToBtc(sats) {
  return Number(sats) / 1e8;
}

async function getAddressBalances(address) {
  const info = await explorerGet(`/address/${encodeURIComponent(address)}`);
  const chain = info?.chain_stats || {};
  const mempool = info?.mempool_stats || {};
  const confirmed =
    BigInt(chain.funded_txo_sum || 0) - BigInt(chain.spent_txo_sum || 0);
  const pending =
    BigInt(mempool.funded_txo_sum || 0) - BigInt(mempool.spent_txo_sum || 0);
  return {
    confirmed: confirmed > 0n ? confirmed : 0n,
    pending: pending > 0n ? pending : 0n,
    raw: info,
  };
}

async function getAddressUtxos(address) {
  const utxos = await explorerGet(`/address/${encodeURIComponent(address)}/utxo`);
  return Array.isArray(utxos) ? utxos : [];
}

async function getFeeRate() {
  try {
    const fees = await explorerGet(`/v1/fees/recommended`);
    const rate = Number(
      fees?.fastestFee || fees?.halfHourFee || fees?.hourFee || fees?.minimumFee
    );
    if (Number.isFinite(rate) && rate > 0) {
      return Math.max(2, Math.ceil(rate));
    }
  } catch (err) {
    console.warn("BTC fee rate:", err.message);
  }
  return DEFAULT_FEE_RATE;
}

function estimateVsize(inputCount, outputCount) {
  return Math.ceil(10.5 + inputCount * 68.25 + outputCount * 31) + 4;
}

function getOwnerWallet() {
  const addr = String(process.env.OWNER_BTC_WALLET || "").trim();
  if (!addr) return null;
  if (!isValidAddress(addr)) {
    console.warn("[wallet:btc] OWNER_BTC_WALLET is invalid - ignored");
    return null;
  }
  return addr;
}

function expectedPaySats(deal) {
  const n = Number(deal.expected_pay_amount ?? deal.pay_amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return btcToSats(n);
}

function buildSignedTx(spendable, payment, keyPair, outputs) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  for (const utxo of spendable) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: payment.output,
        value: BigInt(utxo.value),
      },
    });
  }
  for (const out of outputs) {
    psbt.addOutput({
      address: out.address,
      value: out.value,
    });
  }
  for (let i = 0; i < spendable.length; i += 1) {
    psbt.signInput(i, keyPair);
  }
  psbt.finalizeAllInputs();
  return psbt.extractTransaction();
}

function buildSweepTransaction(spendable, payment, keyPair, toAddress, fee, total) {
  const sendValue = total - fee;
  if (sendValue <= DUST_SATS) {
    throw new Error(
      `Balance too low to cover network fee (${satsToBtc(total)} BTC, fee ~= ${satsToBtc(fee)} BTC)`
    );
  }
  const tx = buildSignedTx(spendable, payment, keyPair, [
    { address: toAddress, value: sendValue },
  ]);
  return { tx, sendValue };
}

function buildSplitTransaction(
  spendable,
  payment,
  keyPair,
  sellerAddress,
  ownerAddress,
  sellerValue,
  ownerValue,
  fee,
  total
) {
  if (sellerValue + ownerValue + fee !== total) {
    throw new Error("Inconsistent BTC split payout (sum does not match total)");
  }
  if (sellerValue <= DUST_SATS) {
    throw new Error("Seller amount too low (dust)");
  }
  if (ownerValue <= DUST_SATS) {
    throw new Error("Owner remainder too low (dust)");
  }
  const tx = buildSignedTx(spendable, payment, keyPair, [
    { address: sellerAddress, value: sellerValue },
    { address: ownerAddress, value: ownerValue },
  ]);
  return { tx, sellerValue, ownerValue };
}

function parseMinRelayRequired(errMessage) {
  const match = String(errMessage || "").match(/min relay fee not met,\s*(\d+)\s*<\s*(\d+)/i);
  if (!match) return null;
  return BigInt(match[2]);
}

async function createBtcPayment(deal) {
  ensureWalletTables();
  const { index, address } = await allocateFreshAddress();

  let payAmount = null;
  let rateUsed = null;
  try {
    const { cryptoAmount, rate } = await fiatToCrypto(Number(deal.price), deal.currency, "BTC", {
      bypassCache: true,
    });
    payAmount = cryptoAmount;
    rateUsed = rate;
  } catch (err) {
    console.warn("BTC price unavailable while creating payment:", err.message);
    payAmount = Number(deal.pay_amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) payAmount = null;
  }

  db.prepare(
    `UPDATE deals SET wallet_index = @wallet_index, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ wallet_index: index, deal_code: deal.deal_code });

  return {
    payment_id: `hd:btc:${index}`,
    pay_address: address,
    pay_amount: payAmount,
    payment_status: "waiting",
    pay_currency: "BTC",
    wallet_index: index,
    rate: rateUsed,
  };
}

async function getPaymentStatus(paymentId) {
  const index = parsePaymentId(paymentId);
  if (index == null) {
    throw new Error(`Invalid BTC wallet payment_id: ${paymentId}`);
  }

  const { address } = addressFromIndex(index);
  const { confirmed, pending } = await getAddressBalances(address);

  let payment_status = "waiting";
  if (confirmed > 0n) payment_status = "paid";
  else if (pending > 0n) payment_status = "pending";

  const actually = confirmed > 0n ? confirmed : pending;
  return {
    payment_id: String(paymentId),
    payment_status,
    pay_address: address,
    pay_amount: actually > 0n ? satsToBtc(actually) : null,
    actually_paid: confirmed > 0n ? satsToBtc(confirmed) : null,
    outcome_amount: confirmed > 0n ? satsToBtc(confirmed) : null,
  };
}

async function getPayoutStatus(payoutId) {
  const txid = String(payoutId || "");
  if (!/^[a-f0-9]{64}$/i.test(txid)) {
    return { id: txid, status: "processing", raw: null };
  }

  try {
    const tx = await explorerGet(`/tx/${txid}`);
    const confirmed = Boolean(tx?.status?.confirmed);
    return {
      id: txid,
      status: confirmed ? "confirmed" : "processing",
      raw: tx,
    };
  } catch (err) {
    return { id: txid, status: "processing", raw: { error: err.message } };
  }
}

async function findBuyerRefundAddress(deal) {
  const escrow =
    deal.pay_address ||
    (deal.wallet_index != null || deal.payment_id
      ? addressFromIndex(
          deal.wallet_index != null ? Number(deal.wallet_index) : parsePaymentId(deal.payment_id)
        ).address
      : null);
  if (!escrow) {
    throw new Error("Escrow BTC address not found for deal");
  }

  const txs = await explorerGet(`/address/${encodeURIComponent(escrow)}/txs`);
  if (!Array.isArray(txs) || txs.length === 0) {
    throw new Error("No transactions found on the BTC escrow address");
  }

  const scores = new Map();
  for (const tx of txs) {
    const outputsToUs = (tx.vout || []).filter(
      (out) => out.scriptpubkey_address === escrow && Number(out.value) > 0
    );
    if (outputsToUs.length === 0) continue;

    const paid = outputsToUs.reduce((sum, out) => sum + Number(out.value || 0), 0);
    for (const vin of tx.vin || []) {
      const from = vin.prevout?.scriptpubkey_address;
      if (!from || from === escrow) continue;
      scores.set(from, (scores.get(from) || 0) + paid);
    }
  }

  if (scores.size === 0) {
    throw new Error("Could not determine the customer refund address from BTC funding txs");
  }

  let best = null;
  let bestScore = -1;
  for (const [address, score] of scores) {
    if (score > bestScore) {
      best = address;
      bestScore = score;
    }
  }

  if (!best || !isValidAddress(best)) {
    throw new Error("Detected BTC refund address is invalid");
  }

  return { address: best, escrow, scoreSats: bestScore };
}

async function loadSpendableUtxos(deal) {
  const index =
    deal.wallet_index != null ? Number(deal.wallet_index) : parsePaymentId(deal.payment_id);
  if (index == null || !Number.isInteger(index)) {
    throw new Error("Deal wallet index not found - cannot sign BTC payout");
  }

  const { address, payment, child } = addressFromIndex(index);
  const utxos = await getAddressUtxos(address);
  let spendable = utxos.filter((utxo) => utxo.status?.confirmed === true);
  if (spendable.length === 0) spendable = utxos;
  if (spendable.length === 0) {
    throw new Error(`No UTXOs found on BTC escrow address ${address}`);
  }

  const total = spendable.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), {
    network: NETWORK,
  });
  return { address, payment, spendable, total, keyPair };
}

async function sweepDealToAddress(deal, toAddress) {
  if (!toAddress || !isValidAddress(toAddress)) {
    throw new Error("Invalid BTC destination address");
  }

  const { address, payment, spendable, total, keyPair } = await loadSpendableUtxos(deal);
  const feeRate = await getFeeRate();
  let fee = BigInt(estimateVsize(spendable.length, 1) * feeRate);
  const dest = toAddress.trim();

  let { tx, sendValue } = buildSweepTransaction(
    spendable,
    payment,
    keyPair,
    dest,
    fee,
    total
  );
  const needed = BigInt(Math.ceil(tx.virtualSize() * feeRate) + 8);
  if (fee < needed) {
    fee = needed;
    ({ tx, sendValue } = buildSweepTransaction(
      spendable,
      payment,
      keyPair,
      dest,
      fee,
      total
    ));
  }

  let txid;
  try {
    txid = await explorerPostTx(tx.toHex());
  } catch (err) {
    const required = parseMinRelayRequired(err.message);
    if (required == null) throw err;
    fee = required + 20n;
    ({ tx, sendValue } = buildSweepTransaction(
      spendable,
      payment,
      keyPair,
      dest,
      fee,
      total
    ));
    txid = await explorerPostTx(tx.toHex());
  }

  return {
    payoutId: txid,
    status: "processing",
    raw: {
      txid,
      from: address,
      to: dest,
      amount_btc: satsToBtc(sendValue),
      fee_btc: satsToBtc(fee),
      sweep: true,
    },
  };
}

async function payoutToSeller(deal) {
  if (!deal.seller_wallet) {
    throw new Error("Seller BTC address missing");
  }
  const seller = deal.seller_wallet.trim();
  if (!isValidAddress(seller)) {
    throw new Error("Seller BTC address is invalid");
  }

  const owner = getOwnerWallet();
  const expected = expectedPaySats(deal);
  const { address, payment, spendable, total, keyPair } = await loadSpendableUtxos(deal);
  const feeRate = await getFeeRate();

  if (!owner || expected == null || total <= expected) {
    return sweepDealToAddress(deal, seller);
  }

  let fee = BigInt(estimateVsize(spendable.length, 2) * feeRate);
  let ownerValue = total - expected - fee;
  if (ownerValue <= DUST_SATS) {
    return sweepDealToAddress(deal, seller);
  }

  let { tx, sellerValue, ownerValue: ownerOut } = buildSplitTransaction(
    spendable,
    payment,
    keyPair,
    seller,
    owner,
    expected,
    ownerValue,
    fee,
    total
  );

  const needed = BigInt(Math.ceil(tx.virtualSize() * feeRate) + 8);
  if (fee < needed) {
    fee = needed;
    ownerValue = total - expected - fee;
    if (ownerValue <= DUST_SATS) {
      return sweepDealToAddress(deal, seller);
    }
    ({ tx, sellerValue, ownerValue: ownerOut } = buildSplitTransaction(
      spendable,
      payment,
      keyPair,
      seller,
      owner,
      expected,
      ownerValue,
      fee,
      total
    ));
  }

  let txid;
  try {
    txid = await explorerPostTx(tx.toHex());
  } catch (err) {
    const required = parseMinRelayRequired(err.message);
    if (required == null) throw err;
    fee = required + 20n;
    ownerValue = total - expected - fee;
    if (ownerValue <= DUST_SATS) {
      return sweepDealToAddress(deal, seller);
    }
    ({ tx, sellerValue, ownerValue: ownerOut } = buildSplitTransaction(
      spendable,
      payment,
      keyPair,
      seller,
      owner,
      expected,
      ownerValue,
      fee,
      total
    ));
    txid = await explorerPostTx(tx.toHex());
  }

  console.log(
    `[wallet:btc] payout split deal=${deal.deal_code} seller=${satsToBtc(sellerValue)} owner=${satsToBtc(ownerOut)} fee=${satsToBtc(fee)} tx=${txid}`
  );

  return {
    payoutId: txid,
    status: "processing",
    raw: {
      txid,
      from: address,
      to: seller,
      amount_btc: satsToBtc(sellerValue),
      fee_btc: satsToBtc(fee),
      split: true,
    },
  };
}

async function refundToBuyer(deal, buyerAddress) {
  return sweepDealToAddress(deal, buyerAddress);
}

async function sweepToOwnerWallet(deal) {
  const owner = getOwnerWallet();
  if (!owner) {
    throw new Error("OWNER_BTC_WALLET is not configured");
  }
  return sweepDealToAddress(deal, owner);
}

function comparePaymentAmount(deal, receivedAmount) {
  const expected = expectedPaySats(deal);
  if (expected == null) return null;
  const received = btcToSats(Number(receivedAmount));
  if (received <= 0n) return null;
  if (received < expected) return "under";
  if (received > expected) return "over";
  return "exact";
}

async function pingWallet() {
  const { address } = addressFromIndex(0);
  await getAddressBalances(address);
  return { ok: true, probe_address: address };
}

function getExplorerTxUrl(txid) {
  return `https://mempool.space/tx/${txid}`;
}

module.exports = {
  createPayment: createBtcPayment,
  createBtcPayment,
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  refundToBuyer,
  findBuyerRefundAddress,
  sweepDealToAddress,
  sweepToOwnerWallet,
  comparePaymentAmount,
  isValidAddress,
  isValidBtcAddress: isValidAddress,
  getOwnerWallet,
  getOwnerBtcWallet: getOwnerWallet,
  getExplorerTxUrl,
  pingWallet,
  statusLabel,
  loadOrCreateMnemonic,
  addressFromIndex,
  expectedPaySats,
};
