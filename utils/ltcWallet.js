const fs = require("fs");
const path = require("path");
const bitcoin = require("bitcoinjs-lib");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const { ECPairFactory } = require("ecpair");
const ecc = require("tiny-secp256k1");
const db = require("../database");
const { fiatToLtc } = require("./ltcPrice");

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const LITECOIN = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

const EXPLORER_BASE = "https://litecoinspace.org/api";
const WALLET_FILE = path.join(__dirname, "..", "wallet.mnemonic");
const ACCOUNT_PATH = "m/84'/2'/0'/0";
/** Dust / fee buffer only — pas de minimum commercial. */
const DUST_LITOSHIS = 546n;
const DEFAULT_FEE_RATE = 2; // lit/vB

const PAID_STATUSES = new Set(["paid"]);
const ACTIVE_STATUSES = new Set(["waiting", "pending", "underpaid"]);
const TERMINAL_FAIL_STATUSES = new Set(["expired", "error", "cancelled"]);
const PAYOUT_DONE = new Set(["confirmed", "done", "completed"]);
const PAYOUT_FAIL = new Set(["failed", "rejected", "error"]);

let rootNode = null;
let mnemonicCached = null;

function fiatCurrencyCode(currencySymbol) {
  if (currencySymbol === "€") return "eur";
  if (currencySymbol === "$") return "usd";
  return String(currencySymbol || "usd").toLowerCase();
}

function statusLabel(status) {
  const labels = {
    waiting: "En attente de paiement",
    pending: "Confirmation blockchain",
    underpaid: "Paiement partiel",
    paid: "Paiement reçu",
    expired: "Expiré",
    error: "Erreur",
    cancelled: "Annulé",
    processing: "Payout diffusé",
    confirming: "Confirmation payout",
    confirmed: "Payout confirmé",
    failed: "Payout échoué",
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

function loadOrCreateMnemonic() {
  if (mnemonicCached) return mnemonicCached;

  const fromEnv = (process.env.LTC_WALLET_MNEMONIC || "").trim();
  if (fromEnv) {
    if (!bip39.validateMnemonic(fromEnv)) {
      throw new Error("LTC_WALLET_MNEMONIC invalide (seed BIP39)");
    }
    mnemonicCached = fromEnv;
    return mnemonicCached;
  }

  if (fs.existsSync(WALLET_FILE)) {
    const fromFile = fs.readFileSync(WALLET_FILE, "utf8").trim();
    if (!bip39.validateMnemonic(fromFile)) {
      throw new Error("wallet.mnemonic invalide — ne remplace pas le fichier à la légère");
    }
    mnemonicCached = fromFile;
    return mnemonicCached;
  }

  const mnemonic = bip39.generateMnemonic(128);
  fs.writeFileSync(WALLET_FILE, `${mnemonic}\n`, { mode: 0o600 });
  console.warn("======================================================");
  console.warn("NOUVEAU WALLET LTC CRÉÉ — SAUVEGARDE CETTE SEED MAINTENANT");
  console.warn(mnemonic);
  console.warn(`Aussi écrite dans ${WALLET_FILE}`);
  console.warn("Sans cette seed, les fonds escrow sont PERDUS.");
  console.warn("======================================================");
  mnemonicCached = mnemonic;
  return mnemonicCached;
}

function getRoot() {
  if (rootNode) return rootNode;
  const mnemonic = loadOrCreateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  rootNode = bip32.fromSeed(seed, LITECOIN);
  return rootNode;
}

function deriveChild(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) {
    throw new Error(`Index wallet invalide: ${index}`);
  }
  return getRoot().derivePath(`${ACCOUNT_PATH}/${i}`);
}

function addressFromIndex(index) {
  const child = deriveChild(index);
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: LITECOIN,
  });
  if (!payment.address) throw new Error("Échec génération adresse LTC");
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
    // déjà présent
  }
}

function allocateWalletIndex() {
  ensureWalletTables();
  const row = db.prepare(`SELECT value FROM wallet_meta WHERE key = 'next_index'`).get();
  let next = row ? Number(row.value) : 0;
  if (!Number.isFinite(next) || next < 0) next = 0;

  db.prepare(
    `INSERT INTO wallet_meta (key, value) VALUES ('next_index', @v)
     ON CONFLICT(key) DO UPDATE SET value = @v`
  ).run({ v: String(next + 1) });

  return next;
}

function parsePaymentId(paymentId) {
  const raw = String(paymentId || "");
  const match = raw.match(/^hd:(\d+)$/i);
  if (!match) return null;
  return Number(match[1]);
}

async function explorerGet(pathname) {
  const res = await fetch(`${EXPLORER_BASE}${pathname}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Explorer LTC HTTP ${res.status}: ${text.slice(0, 160)}`);
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
    throw new Error(`Broadcast échoué (${res.status}): ${text.slice(0, 200)}`);
  }
  return text.trim();
}

function ltcToLitoshis(ltc) {
  const n = Number(ltc);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1e8));
}

function litoshisToLtc(sats) {
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
      // Floor à 2 lit/vB + marge : le min-relay LTC rejette souvent 1 lit/vB exact
      return Math.max(2, Math.ceil(rate));
    }
  } catch (err) {
    console.warn("Fee rate LTC:", err.message);
  }
  return DEFAULT_FEE_RATE;
}

function estimateVsize(inputCount, outputCount) {
  // P2WPKH weight/4 — léger surplus pour éviter min-relay "109 < 113"
  return Math.ceil(10.5 + inputCount * 68.25 + outputCount * 31) + 4;
}

function buildSweepTransaction(spendable, payment, keyPair, toAddress, fee, total) {
  const sendValue = total - fee;
  if (sendValue <= DUST_LITOSHIS) {
    throw new Error(
      `Solde trop bas pour couvrir les frais réseau (${litoshisToLtc(total)} LTC, frais ≈ ${litoshisToLtc(fee)} LTC)`
    );
  }

  const psbt = new bitcoin.Psbt({ network: LITECOIN });
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
  psbt.addOutput({
    address: toAddress,
    value: sendValue,
  });

  for (let i = 0; i < spendable.length; i++) {
    psbt.signInput(i, keyPair);
  }
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { tx, sendValue };
}

function parseMinRelayRequired(errMessage) {
  const match = String(errMessage || "").match(/min relay fee not met,\s*(\d+)\s*<\s*(\d+)/i);
  if (!match) return null;
  return BigInt(match[2]);
}

/** Pas de minimum commercial — soft-check dust seulement (jamais bloquant). */
async function assertAboveMinAmount() {
  return { minCrypto: 0, estimated: null };
}

/**
 * Génère une adresse LTC unique (HD) pour ce deal.
 * Chaque regen alloue un nouvel index — l'ancienne adresse n'est plus réutilisée.
 */
async function createLtcPayment(deal) {
  ensureWalletTables();
  const index = allocateWalletIndex();
  const { address } = addressFromIndex(index);

  // Toujours recalculer au cours live (pas le montant figé à la création du deal)
  let payAmount = null;
  let rateUsed = null;
  try {
    const { cryptoAmount, rate } = await fiatToLtc(Number(deal.price), deal.currency, {
      bypassCache: true,
    });
    payAmount = cryptoAmount;
    rateUsed = rate;
  } catch (err) {
    console.warn("Cours LTC indisponible à la création paiement:", err.message);
    payAmount = Number(deal.pay_amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) payAmount = null;
  }

  db.prepare(
    `UPDATE deals SET wallet_index = @wallet_index, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ wallet_index: index, deal_code: deal.deal_code });

  return {
    payment_id: `hd:${index}`,
    pay_address: address,
    pay_amount: payAmount,
    payment_status: "waiting",
    pay_currency: "LTC",
    wallet_index: index,
    rate: rateUsed,
  };
}

async function getPaymentStatus(paymentId) {
  const index = parsePaymentId(paymentId);
  if (index == null) {
    throw new Error(`payment_id wallet invalide: ${paymentId}`);
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
    pay_amount: actually > 0n ? litoshisToLtc(actually) : null,
    actually_paid: confirmed > 0n ? litoshisToLtc(confirmed) : null,
    outcome_amount: confirmed > 0n ? litoshisToLtc(confirmed) : null,
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
    // tx pas encore indexée
    return { id: txid, status: "processing", raw: { error: err.message } };
  }
}

/**
 * Sweep les UTXO du deal vers une adresse LTC (vendeur ou remboursement acheteur).
 */
async function sweepDealToAddress(deal, toAddress) {
  if (!toAddress || !isValidLtcAddress(toAddress)) {
    throw new Error("Adresse LTC de destination invalide");
  }

  const index =
    deal.wallet_index != null
      ? Number(deal.wallet_index)
      : parsePaymentId(deal.payment_id);
  if (index == null || !Number.isInteger(index)) {
    throw new Error("Index wallet du deal introuvable — impossible de signer");
  }

  const { address, payment, child } = addressFromIndex(index);
  const utxos = await getAddressUtxos(address);

  let spendable = utxos.filter((u) => u.status?.confirmed === true);
  if (spendable.length === 0) spendable = utxos;
  if (spendable.length === 0) {
    throw new Error(`Aucun UTXO sur l'adresse escrow ${address}`);
  }

  const total = spendable.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const feeRate = await getFeeRate();
  let fee = BigInt(estimateVsize(spendable.length, 1) * feeRate);

  const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), {
    network: LITECOIN,
  });
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
      amount_ltc: litoshisToLtc(sendValue),
      fee_ltc: litoshisToLtc(fee),
      unused_address: true,
    },
  };
}

/**
 * Envoie les LTC de l'adresse du deal vers le vendeur (sweep minus fees).
 */
async function payoutToSeller(deal, paymentDetails) {
  if (!deal.seller_wallet) {
    throw new Error("Adresse LTC du vendeur manquante");
  }
  return sweepDealToAddress(deal, deal.seller_wallet.trim());
}

/** Rembourse l'acheteur (litige) vers son adresse LTC. */
async function refundToBuyer(deal, buyerAddress) {
  return sweepDealToAddress(deal, buyerAddress);
}

async function pingWallet() {
  const { address } = addressFromIndex(0);
  await getAddressBalances(address);
  return { ok: true, probe_address: address };
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
  refundToBuyer,
  sweepDealToAddress,
  resolvePayoutAmount,
  statusLabel,
  isPaidStatus,
  isActiveStatus,
  isFailedStatus,
  isPayoutDoneStatus,
  isPayoutFailedStatus,
  isValidLtcAddress,
  fiatCurrencyCode,
  pingWallet,
  loadOrCreateMnemonic,
  addressFromIndex,
  LTC_MIN_AMOUNT: 0,
};
