const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bip39 = require("bip39");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");
const db = require("../database");
const { loadOrCreateMnemonic } = require("./sharedMnemonic");
const { fiatToCrypto } = require("./cryptoPrice");

const INDEX_FILE = path.join(__dirname, "..", "wallet.next_index_sol");
const INDEX_KEY = "next_index_sol";
const DEAL_CRYPTO = "SOL";
const MAX_USED_SKIP = 200;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const PREFERRED_RENT_RESERVE = 890_880n;

let connection = null;
let keypairCache = new Map();

/** SLIP-0010 ed25519 HD derivation (CommonJS — avoids ESM-only ed25519-hd-key). */
function hmacSha512(key, data) {
  return crypto.createHmac("sha512", key).update(data).digest();
}

function getMasterKeyFromSeed(seed) {
  const I = hmacSha512(Buffer.from("ed25519 seed", "utf8"), seed);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

function CKDPriv(parent, index) {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index >>> 0, 0);
  const data = Buffer.concat([Buffer.from([0]), parent.key, indexBuf]);
  const I = hmacSha512(parent.chainCode, data);
  return { key: I.subarray(0, 32), chainCode: I.subarray(32) };
}

function derivePath(pathStr, seed) {
  if (!/^m(\/[0-9]+')+$/.test(pathStr)) {
    throw new Error(`Invalid ed25519 derivation path: ${pathStr}`);
  }
  let node = getMasterKeyFromSeed(seed);
  const parts = pathStr.replace(/^m\//, "").split("/");
  for (const part of parts) {
    const hardened = part.endsWith("'");
    const raw = Number(hardened ? part.slice(0, -1) : part);
    if (!Number.isInteger(raw) || raw < 0) {
      throw new Error(`Invalid path segment: ${part}`);
    }
    // ed25519 HD only supports hardened children
    const index = (raw | 0x80000000) >>> 0;
    node = CKDPriv(node, index);
  }
  return node;
}

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

function getConnection() {
  if (connection) return connection;
  const rpcUrl =
    String(process.env.SOL_RPC_URL || "").trim() || "https://api.mainnet-beta.solana.com";
  connection = new Connection(rpcUrl, "confirmed");
  return connection;
}

function deriveKeypair(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) {
    throw new Error(`Invalid SOL wallet index: ${index}`);
  }
  if (keypairCache.has(i)) return keypairCache.get(i);

  const mnemonic = loadOrCreateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const derived = derivePath(`m/44'/501'/${i}'/0'`, seed);
  const keypair = Keypair.fromSeed(derived.key);
  keypairCache.set(i, keypair);
  return keypair;
}

function addressFromIndex(index) {
  return deriveKeypair(index).publicKey.toBase58();
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
    console.warn("wallet.next_index_sol:", err.message);
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
  const value = String(Math.max(0, Math.floor(nextAfter)));
  db.prepare(
    `INSERT INTO wallet_meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key: INDEX_KEY, value });
  writeIndexFile(nextAfter);
}

function allocateWalletIndex() {
  const next = peekNextWalletIndex();
  commitWalletIndex(next + 1);
  return next;
}

async function allocateFreshAddress() {
  const conn = getConnection();
  for (let attempt = 0; attempt < MAX_USED_SKIP; attempt += 1) {
    const index = allocateWalletIndex();
    const keypair = deriveKeypair(index);
    try {
      const [balance, signatures] = await Promise.all([
        conn.getBalance(keypair.publicKey, "confirmed"),
        conn.getSignaturesForAddress(keypair.publicKey, { limit: 1 }, "confirmed"),
      ]);
      if (Number(balance) > 0 || (Array.isArray(signatures) && signatures.length > 0)) {
        console.warn(
          `[wallet:sol] skip used address index=${index} ${keypair.publicKey.toBase58()}`
        );
        continue;
      }
    } catch (err) {
      console.warn(`[wallet:sol] address history check failed index=${index}: ${err.message}`);
    }
    return { index, address: keypair.publicKey.toBase58() };
  }
  throw new Error("Unable to find a fresh SOL address.");
}

function parsePaymentId(paymentId) {
  const raw = String(paymentId || "");
  const match = raw.match(/^hd:sol:(\d+)$/i);
  if (!match) return null;
  return Number(match[1]);
}

function toDecimalString(value, decimals) {
  if (value == null || value === "") return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value.toFixed(decimals);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/e/i.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toFixed(decimals);
  }
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  return raw;
}

function decimalToUnits(value, decimals) {
  const str = toDecimalString(value, decimals);
  if (!str) return null;
  const [whole, frac = ""] = str.split(".");
  const fracPadded = `${frac}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

function solToLamports(value) {
  return decimalToUnits(value, 9);
}

function lamportsToSol(lamports) {
  return Number(lamports) / 1e9;
}

function expectedPayLamports(deal) {
  return solToLamports(deal.expected_pay_amount ?? deal.pay_amount);
}

function isValidAddress(address) {
  try {
    return Boolean(address && new PublicKey(String(address).trim()));
  } catch {
    return false;
  }
}

function getOwnerWallet() {
  const addr = String(process.env.OWNER_SOL_WALLET || "").trim();
  if (!addr) return null;
  if (!isValidAddress(addr)) {
    console.warn("[wallet:sol] OWNER_SOL_WALLET is invalid - ignored");
    return null;
  }
  return new PublicKey(addr).toBase58();
}

function resolveDealIndex(deal) {
  const index =
    deal.wallet_index != null ? Number(deal.wallet_index) : parsePaymentId(deal.payment_id);
  if (index == null || !Number.isInteger(index)) {
    throw new Error("Deal wallet index not found - cannot access SOL escrow wallet");
  }
  return index;
}

function resolveEscrowAddress(deal) {
  return deal.pay_address || addressFromIndex(resolveDealIndex(deal));
}

async function getBalances(pubkey) {
  const conn = getConnection();
  const confirmed = BigInt(await conn.getBalance(pubkey, "confirmed"));
  let processed = confirmed;
  try {
    processed = BigInt(await conn.getBalance(pubkey, "processed"));
  } catch {
    // some RPCs may not honor processed balance
  }
  return { confirmed, processed };
}

async function createSolPayment(deal) {
  ensureWalletTables();
  const { index, address } = await allocateFreshAddress();

  let payAmount = null;
  let rateUsed = null;
  try {
    const { cryptoAmount, rate } = await fiatToCrypto(Number(deal.price), deal.currency, "SOL", {
      bypassCache: true,
    });
    payAmount = cryptoAmount;
    rateUsed = rate;
  } catch (err) {
    console.warn("SOL price unavailable while creating payment:", err.message);
    payAmount = Number(deal.pay_amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) payAmount = null;
  }

  db.prepare(
    `UPDATE deals SET wallet_index = @wallet_index, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ wallet_index: index, deal_code: deal.deal_code });

  return {
    payment_id: `hd:sol:${index}`,
    pay_address: address,
    pay_amount: payAmount,
    payment_status: "waiting",
    pay_currency: "SOL",
    wallet_index: index,
    rate: rateUsed,
  };
}

async function getPaymentStatus(paymentId) {
  const index = parsePaymentId(paymentId);
  if (index == null) {
    throw new Error(`Invalid SOL wallet payment_id: ${paymentId}`);
  }

  const keypair = deriveKeypair(index);
  const { confirmed, processed } = await getBalances(keypair.publicKey);

  let payment_status = "waiting";
  if (confirmed > 0n) payment_status = "paid";
  else if (processed > 0n) payment_status = "pending";

  const visible = confirmed > 0n ? confirmed : processed;
  return {
    payment_id: String(paymentId),
    payment_status,
    pay_address: keypair.publicKey.toBase58(),
    pay_amount: visible > 0n ? lamportsToSol(visible) : null,
    actually_paid: confirmed > 0n ? lamportsToSol(confirmed) : null,
    outcome_amount: confirmed > 0n ? lamportsToSol(confirmed) : null,
  };
}

async function getPayoutStatus(payoutId) {
  const sig = String(payoutId || "");
  if (!sig) return { id: sig, status: "processing", raw: null };

  try {
    const conn = getConnection();
    const { value } = await conn.getSignatureStatuses([sig], {
      searchTransactionHistory: true,
    });
    const info = value?.[0] || null;
    if (!info) return { id: sig, status: "processing", raw: null };
    if (info.err) return { id: sig, status: "failed", raw: info };
    if (
      info.confirmationStatus === "confirmed" ||
      info.confirmationStatus === "finalized" ||
      info.confirmations === null
    ) {
      return { id: sig, status: "confirmed", raw: info };
    }
    return { id: sig, status: "processing", raw: info };
  } catch (err) {
    return { id: sig, status: "processing", raw: { error: err.message } };
  }
}

async function findBuyerRefundAddress(deal) {
  const conn = getConnection();
  const escrow = resolveEscrowAddress(deal);
  const escrowKey = new PublicKey(escrow);
  const signatures = await conn.getSignaturesForAddress(escrowKey, { limit: 20 }, "confirmed");
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new Error("No transactions found on the SOL escrow address");
  }

  const scores = new Map();
  for (const sigInfo of signatures) {
    let parsed = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      parsed = await conn.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch (err) {
      console.warn(`[wallet:sol] parsed tx unavailable ${sigInfo.signature}: ${err.message}`);
      continue;
    }
    if (!parsed) continue;

    let matchedTransfer = false;
    for (const ix of parsed.transaction.message.instructions || []) {
      if (ix.program !== "system" || ix.parsed?.type !== "transfer") continue;
      const info = ix.parsed?.info || {};
      const destination = String(info.destination || "");
      const source = String(info.source || "");
      const lamports = BigInt(info.lamports || 0);
      if (destination !== escrow || !source || source === escrow || lamports <= 0n) continue;
      scores.set(source, (scores.get(source) || 0n) + lamports);
      matchedTransfer = true;
    }

    if (matchedTransfer) continue;

    const keys = parsed.transaction.message.accountKeys || [];
    const escrowIndex = keys.findIndex(
      (entry) => entry?.pubkey?.toBase58?.() === escrow || String(entry?.pubkey || "") === escrow
    );
    if (escrowIndex < 0) continue;

    const pre = BigInt(parsed.meta?.preBalances?.[escrowIndex] || 0);
    const post = BigInt(parsed.meta?.postBalances?.[escrowIndex] || 0);
    if (post <= pre) continue;

    const signer = keys.find((entry) => {
      const value = entry?.pubkey?.toBase58?.() || String(entry?.pubkey || "");
      return entry?.signer && value && value !== escrow;
    });
    const signerAddress =
      signer?.pubkey?.toBase58?.() || (signer?.pubkey ? String(signer.pubkey) : null);
    if (!signerAddress) continue;
    scores.set(signerAddress, (scores.get(signerAddress) || 0n) + (post - pre));
  }

  if (scores.size === 0) {
    throw new Error("Could not determine the customer SOL refund address from funding txs");
  }

  let best = null;
  let bestScore = -1n;
  for (const [address, score] of scores) {
    if (score > bestScore) {
      best = address;
      bestScore = score;
    }
  }

  if (!best || !isValidAddress(best)) {
    throw new Error("Detected SOL refund address is invalid");
  }

  return {
    address: new PublicKey(best).toBase58(),
    escrow,
    scoreLamports: bestScore.toString(),
  };
}

async function loadEscrowKeypair(deal) {
  const index = resolveDealIndex(deal);
  const keypair = deriveKeypair(index);
  const conn = getConnection();
  const balance = BigInt(await conn.getBalance(keypair.publicKey, "confirmed"));
  return { connection: conn, keypair, balance };
}

function toSafeLamportsNumber(lamports) {
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("SOL amount is too large to encode safely");
  }
  return Number(lamports);
}

async function estimateTransferFee(connectionToUse, fromPubkey, toPubkey, lamports) {
  const { blockhash } = await connectionToUse.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: fromPubkey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: toSafeLamportsNumber(lamports > 0n ? lamports : 1n),
    })
  );
  const fee = await connectionToUse.getFeeForMessage(tx.compileMessage(), "confirmed");
  return BigInt(fee?.value || 5000);
}

async function sendTransfer(connectionToUse, keypair, toPubkey, lamports) {
  const { blockhash, lastValidBlockHeight } = await connectionToUse.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey,
      lamports: toSafeLamportsNumber(lamports),
    })
  );
  tx.sign(keypair);
  const signature = await connectionToUse.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  return { signature, blockhash, lastValidBlockHeight };
}

function resolveSweepValue(balance, fee) {
  const withReserve = balance - fee - PREFERRED_RENT_RESERVE;
  if (withReserve > 0n) return withReserve;
  const sweepAll = balance - fee;
  return sweepAll > 0n ? sweepAll : 0n;
}

async function sweepAccountToAddress(deal, toAddress) {
  if (!toAddress || !isValidAddress(toAddress)) {
    throw new Error("Invalid SOL destination address");
  }

  const dest = new PublicKey(toAddress);
  const { connection: conn, keypair, balance } = await loadEscrowKeypair(deal);
  const fee = await estimateTransferFee(conn, keypair.publicKey, dest, 1n);
  const sendValue = resolveSweepValue(balance, fee);

  if (sendValue <= 0n) {
    throw new Error(
      `Escrow SOL balance is too low to cover network fee (${lamportsToSol(balance)} SOL, fee ~= ${lamportsToSol(fee)} SOL)`
    );
  }

  const sent = await sendTransfer(conn, keypair, dest, sendValue);
  return {
    payoutId: sent.signature,
    status: "processing",
    raw: {
      txid: sent.signature,
      from: keypair.publicKey.toBase58(),
      to: dest.toBase58(),
      amount_sol: lamportsToSol(sendValue),
      fee_sol: lamportsToSol(fee),
      reserve_retained_lamports:
        balance - sendValue - fee > 0n ? (balance - sendValue - fee).toString() : "0",
      sweep: true,
    },
  };
}

async function payoutToSeller(deal) {
  if (!deal.seller_wallet) {
    throw new Error("Seller SOL address missing");
  }
  if (!isValidAddress(deal.seller_wallet)) {
    throw new Error("Seller SOL address is invalid");
  }

  const seller = new PublicKey(deal.seller_wallet);
  const owner = getOwnerWallet();
  const expected = expectedPayLamports(deal);
  if (expected == null || expected <= 0n) {
    throw new Error("Expected SOL payment amount is missing");
  }

  const { connection: conn, keypair, balance } = await loadEscrowKeypair(deal);
  const sellerFee = await estimateTransferFee(conn, keypair.publicKey, seller, expected);
  if (balance < expected + sellerFee) {
    throw new Error(
      `Escrow SOL balance cannot cover seller exact payout plus fee (balance ${lamportsToSol(balance)} SOL, need at least ${lamportsToSol(expected + sellerFee)} SOL)`
    );
  }

  let ownerTx = null;
  let ownerValue = 0n;
  let ownerFee = 0n;
  if (owner && owner !== seller.toBase58()) {
    const ownerKey = new PublicKey(owner);
    ownerFee = await estimateTransferFee(conn, keypair.publicKey, ownerKey, 1n);
    const remainder = balance - expected - sellerFee - ownerFee;
    if (remainder > 0n) ownerValue = remainder;
  }

  const sellerTx = await sendTransfer(conn, keypair, seller, expected);
  if (ownerValue > 0n) {
    ownerTx = await sendTransfer(conn, keypair, new PublicKey(owner), ownerValue);
  }

  return {
    payoutId: sellerTx.signature,
    status: "processing",
    raw: {
      txid: sellerTx.signature,
      owner_txid: ownerTx?.signature || null,
      from: keypair.publicKey.toBase58(),
      to: seller.toBase58(),
      amount_sol: lamportsToSol(expected),
      owner_amount_sol: ownerValue > 0n ? lamportsToSol(ownerValue) : 0,
      fee_sol: lamportsToSol(sellerFee + ownerFee),
      split: ownerValue > 0n,
    },
  };
}

async function refundToBuyer(deal, buyerAddress) {
  return sweepAccountToAddress(deal, buyerAddress);
}

async function sweepToOwnerWallet(deal) {
  const owner = getOwnerWallet();
  if (!owner) {
    throw new Error("OWNER_SOL_WALLET is not configured");
  }
  return sweepAccountToAddress(deal, owner);
}

function comparePaymentAmount(deal, receivedAmount) {
  const expected = expectedPayLamports(deal);
  if (expected == null) return null;
  const received = solToLamports(receivedAmount);
  if (received == null || received <= 0n) return null;
  if (received < expected) return "under";
  if (received > expected) return "over";
  return "exact";
}

async function pingWallet() {
  const keypair = deriveKeypair(0);
  await getConnection().getBalance(keypair.publicKey, "confirmed");
  return { ok: true, probe_address: keypair.publicKey.toBase58() };
}

function getExplorerTxUrl(txid) {
  return `https://solscan.io/tx/${txid}`;
}

module.exports = {
  createPayment: createSolPayment,
  createSolPayment,
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  refundToBuyer,
  findBuyerRefundAddress,
  sweepToOwnerWallet,
  comparePaymentAmount,
  isValidAddress,
  isValidSolAddress: isValidAddress,
  getOwnerWallet,
  getOwnerSolWallet: getOwnerWallet,
  getExplorerTxUrl,
  pingWallet,
  statusLabel,
  loadOrCreateMnemonic,
  addressFromIndex,
  expectedPayLamports,
};
