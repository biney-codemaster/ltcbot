const fs = require("fs");
const path = require("path");
const bip39 = require("bip39");
const ethers = require("ethers");
const db = require("../database");
const { loadOrCreateMnemonic } = require("./sharedMnemonic");
const { fiatToCrypto } = require("./cryptoPrice");

const INDEX_FILE = path.join(__dirname, "..", "wallet.next_index_eth");
const INDEX_KEY = "next_index_eth";
const DEAL_CRYPTO = "ETH";
const MAX_USED_SKIP = 200;
const DEFAULT_GAS_PRICE = ethers.parseUnits("2", "gwei");

let hdRoot = null;
let providerEntries = null;
let providerKey = "";

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

function getHdRoot() {
  if (hdRoot) return hdRoot;
  const mnemonic = loadOrCreateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  hdRoot = ethers.HDNodeWallet.fromSeed(seed);
  return hdRoot;
}

function walletFromIndex(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) {
    throw new Error(`Invalid ETH wallet index: ${index}`);
  }
  return getHdRoot().derivePath(`m/44'/60'/0'/0/${i}`);
}

function addressFromIndex(index) {
  return walletFromIndex(index).address;
}

function getRpcUrls() {
  const urls = [
    String(process.env.ETH_RPC_URL || "").trim(),
    "https://cloudflare-eth.com",
    "https://eth.llamarpc.com",
  ].filter(Boolean);
  return [...new Set(urls)];
}

function getProviderEntries() {
  const urls = getRpcUrls();
  const key = urls.join("|");
  if (providerEntries && providerKey === key) return providerEntries;
  providerEntries = urls.map((url) => ({
    url,
    provider: new ethers.JsonRpcProvider(url),
  }));
  providerKey = key;
  return providerEntries;
}

async function getHealthyProvider() {
  let lastErr = null;
  for (const entry of getProviderEntries()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await entry.provider.getBlockNumber();
      return entry.provider;
    } catch (err) {
      lastErr = err;
      console.warn(`[wallet:eth] RPC unavailable ${entry.url}: ${err.message}`);
    }
  }
  throw new Error(`ETH RPC unavailable: ${lastErr?.message || "no provider responded"}`);
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
    console.warn("wallet.next_index_eth:", err.message);
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
  const provider = await getHealthyProvider();
  for (let attempt = 0; attempt < MAX_USED_SKIP; attempt += 1) {
    const index = allocateWalletIndex();
    const address = addressFromIndex(index);
    try {
      const [latestBalance, pendingBalance, latestNonce, pendingNonce] = await Promise.all([
        provider.getBalance(address, "latest"),
        provider.getBalance(address, "pending").catch(() => 0n),
        provider.getTransactionCount(address, "latest"),
        provider.getTransactionCount(address, "pending").catch(() => 0),
      ]);
      if (
        latestBalance > 0n ||
        pendingBalance > 0n ||
        Number(latestNonce) > 0 ||
        Number(pendingNonce) > 0
      ) {
        console.warn(`[wallet:eth] skip used address index=${index} ${address}`);
        continue;
      }
    } catch (err) {
      console.warn(`[wallet:eth] address history check failed index=${index}: ${err.message}`);
    }
    return { index, address };
  }
  throw new Error("Unable to find a fresh ETH address.");
}

function parsePaymentId(paymentId) {
  const raw = String(paymentId || "");
  const match = raw.match(/^hd:eth:(\d+)$/i);
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

function ethToWei(value) {
  return decimalToUnits(value, 18);
}

function weiToEth(wei) {
  return Number(ethers.formatEther(wei));
}

function expectedPayWei(deal) {
  return ethToWei(deal.expected_pay_amount ?? deal.pay_amount);
}

function isValidAddress(address) {
  return Boolean(address && ethers.isAddress(address));
}

function getOwnerWallet() {
  const addr = String(process.env.OWNER_ETH_WALLET || "").trim();
  if (!addr) return null;
  if (!isValidAddress(addr)) {
    console.warn("[wallet:eth] OWNER_ETH_WALLET is invalid - ignored");
    return null;
  }
  return ethers.getAddress(addr);
}

async function getBalanceWithPending(provider, address) {
  const confirmed = await provider.getBalance(address, "latest");
  let pending = confirmed;
  try {
    pending = await provider.getBalance(address, "pending");
  } catch {
    // some RPCs do not support pending blockTag
  }
  return { confirmed, pending };
}

async function getGasConfig(provider) {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || DEFAULT_GAS_PRICE;
  return {
    gasPrice,
    overrides: { gasPrice },
  };
}

async function estimateTransferGas(provider, from, to, value) {
  try {
    return await provider.estimateGas({ from, to, value });
  } catch (err) {
    throw new Error(`ETH gas estimation failed: ${err.message}`);
  }
}

async function createEthPayment(deal) {
  ensureWalletTables();
  const { index, address } = await allocateFreshAddress();

  let payAmount = null;
  let rateUsed = null;
  try {
    const { cryptoAmount, rate } = await fiatToCrypto(Number(deal.price), deal.currency, "ETH", {
      bypassCache: true,
    });
    payAmount = cryptoAmount;
    rateUsed = rate;
  } catch (err) {
    console.warn("ETH price unavailable while creating payment:", err.message);
    payAmount = Number(deal.pay_amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) payAmount = null;
  }

  db.prepare(
    `UPDATE deals SET wallet_index = @wallet_index, updated_at = datetime('now')
     WHERE deal_code = @deal_code`
  ).run({ wallet_index: index, deal_code: deal.deal_code });

  return {
    payment_id: `hd:eth:${index}`,
    pay_address: address,
    pay_amount: payAmount,
    payment_status: "waiting",
    pay_currency: "ETH",
    wallet_index: index,
    rate: rateUsed,
  };
}

async function getPaymentStatus(paymentId) {
  const index = parsePaymentId(paymentId);
  if (index == null) {
    throw new Error(`Invalid ETH wallet payment_id: ${paymentId}`);
  }

  const provider = await getHealthyProvider();
  const address = addressFromIndex(index);
  const { confirmed, pending } = await getBalanceWithPending(provider, address);

  let payment_status = "waiting";
  if (confirmed > 0n) payment_status = "paid";
  else if (pending > 0n) payment_status = "pending";

  const visible = confirmed > 0n ? confirmed : pending;
  return {
    payment_id: String(paymentId),
    payment_status,
    pay_address: address,
    pay_amount: visible > 0n ? weiToEth(visible) : null,
    actually_paid: confirmed > 0n ? weiToEth(confirmed) : null,
    outcome_amount: confirmed > 0n ? weiToEth(confirmed) : null,
  };
}

async function getPayoutStatus(payoutId) {
  const txid = String(payoutId || "");
  if (!/^0x[a-f0-9]{64}$/i.test(txid)) {
    return { id: txid, status: "processing", raw: null };
  }

  const provider = await getHealthyProvider();
  try {
    const receipt = await provider.getTransactionReceipt(txid);
    if (!receipt) {
      return { id: txid, status: "processing", raw: null };
    }
    if (receipt.status === 1 && receipt.blockNumber) {
      return { id: txid, status: "confirmed", raw: receipt };
    }
    if (receipt.status === 0) {
      return { id: txid, status: "failed", raw: receipt };
    }
    return { id: txid, status: "processing", raw: receipt };
  } catch (err) {
    return { id: txid, status: "processing", raw: { error: err.message } };
  }
}

function resolveDealIndex(deal) {
  const index =
    deal.wallet_index != null ? Number(deal.wallet_index) : parsePaymentId(deal.payment_id);
  if (index == null || !Number.isInteger(index)) {
    throw new Error("Deal wallet index not found - cannot access ETH escrow wallet");
  }
  return index;
}

function resolveEscrowAddress(deal) {
  return deal.pay_address || addressFromIndex(resolveDealIndex(deal));
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function findBuyerRefundAddress(deal) {
  const escrow = resolveEscrowAddress(deal);
  const lowerEscrow = escrow.toLowerCase();

  try {
    const data = await fetchJson(
      `https://api.etherscan.io/api?module=account&action=txlist&address=${encodeURIComponent(escrow)}&page=1&offset=100&sort=desc`
    );
    const result = Array.isArray(data?.result) ? data.result : [];
    const scores = new Map();

    for (const tx of result) {
      const to = String(tx?.to || "").toLowerCase();
      const from = String(tx?.from || "").toLowerCase();
      const value = BigInt(tx?.value || "0");
      if (to !== lowerEscrow || !from || from === lowerEscrow || value <= 0n) continue;
      scores.set(from, (scores.get(from) || 0n) + value);
    }

    if (scores.size === 0) {
      throw new Error("No readable inbound funding txs found on Etherscan");
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
      throw new Error("Detected ETH refund address is invalid");
    }

    return {
      address: ethers.getAddress(best),
      escrow,
      scoreWei: bestScore.toString(),
    };
  } catch (err) {
    throw new Error(
      `Could not auto-detect the buyer ETH refund address. Please enter it manually. (${err.message})`
    );
  }
}

async function loadEscrowWallet(deal) {
  const provider = await getHealthyProvider();
  const index = resolveDealIndex(deal);
  const wallet = walletFromIndex(index).connect(provider);
  const balance = await provider.getBalance(wallet.address, "latest");
  return { provider, wallet, balance };
}

async function sweepAccountToAddress(deal, toAddress) {
  if (!toAddress || !isValidAddress(toAddress)) {
    throw new Error("Invalid ETH destination address");
  }

  const dest = ethers.getAddress(toAddress);
  const { provider, wallet, balance } = await loadEscrowWallet(deal);
  const { gasPrice, overrides } = await getGasConfig(provider);
  const probeValue = balance > 0n ? 1n : 0n;
  const gasLimit = await estimateTransferGas(provider, wallet.address, dest, probeValue);
  const fee = gasLimit * gasPrice;
  const sendValue = balance - fee;

  if (sendValue <= 0n) {
    throw new Error(
      `Escrow ETH balance is too low to cover network fee (${weiToEth(balance)} ETH, fee ~= ${weiToEth(fee)} ETH)`
    );
  }

  const tx = await wallet.sendTransaction({
    to: dest,
    value: sendValue,
    gasLimit,
    ...overrides,
  });

  return {
    payoutId: tx.hash,
    status: "processing",
    raw: {
      txid: tx.hash,
      from: wallet.address,
      to: dest,
      amount_eth: weiToEth(sendValue),
      fee_eth: weiToEth(fee),
      sweep: true,
    },
  };
}

async function payoutToSeller(deal) {
  if (!deal.seller_wallet) {
    throw new Error("Seller ETH address missing");
  }
  if (!isValidAddress(deal.seller_wallet)) {
    throw new Error("Seller ETH address is invalid");
  }

  const seller = ethers.getAddress(deal.seller_wallet);
  const owner = getOwnerWallet();
  const expected = expectedPayWei(deal);
  if (expected == null || expected <= 0n) {
    throw new Error("Expected ETH payment amount is missing");
  }

  const { provider, wallet, balance } = await loadEscrowWallet(deal);
  const { gasPrice, overrides } = await getGasConfig(provider);
  const sellerGas = await estimateTransferGas(provider, wallet.address, seller, expected);
  const sellerFee = sellerGas * gasPrice;

  if (balance < expected + sellerFee) {
    throw new Error(
      `Escrow ETH balance cannot cover seller exact payout plus gas (balance ${weiToEth(balance)} ETH, need at least ${weiToEth(expected + sellerFee)} ETH)`
    );
  }

  let ownerValue = 0n;
  let ownerFee = 0n;
  let ownerTx = null;
  let ownerGas = 0n;
  if (owner && owner !== seller) {
    ownerGas = await estimateTransferGas(provider, wallet.address, owner, 1n);
    ownerFee = ownerGas * gasPrice;
    const remainder = balance - expected - sellerFee - ownerFee;
    if (remainder > 0n) ownerValue = remainder;
  }

  const nonce = await provider.getTransactionCount(wallet.address, "latest");
  const sellerTx = await wallet.sendTransaction({
    to: seller,
    value: expected,
    gasLimit: sellerGas,
    nonce,
    ...overrides,
  });

  if (ownerValue > 0n) {
    ownerTx = await wallet.sendTransaction({
      to: owner,
      value: ownerValue,
      gasLimit: ownerGas,
      nonce: nonce + 1,
      ...overrides,
    });
  }

  return {
    payoutId: sellerTx.hash,
    status: "processing",
    raw: {
      txid: sellerTx.hash,
      owner_txid: ownerTx?.hash || null,
      from: wallet.address,
      to: seller,
      amount_eth: weiToEth(expected),
      owner_amount_eth: ownerValue > 0n ? weiToEth(ownerValue) : 0,
      fee_eth: weiToEth(sellerFee + ownerFee),
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
    throw new Error("OWNER_ETH_WALLET is not configured");
  }
  return sweepAccountToAddress(deal, owner);
}

function comparePaymentAmount(deal, receivedAmount) {
  const expected = expectedPayWei(deal);
  if (expected == null) return null;
  const received = ethToWei(receivedAmount);
  if (received == null || received <= 0n) return null;
  if (received < expected) return "under";
  if (received > expected) return "over";
  return "exact";
}

async function pingWallet() {
  const provider = await getHealthyProvider();
  const address = addressFromIndex(0);
  await provider.getBalance(address, "latest");
  return { ok: true, probe_address: address };
}

function getExplorerTxUrl(txid) {
  return `https://etherscan.io/tx/${txid}`;
}

module.exports = {
  createPayment: createEthPayment,
  createEthPayment,
  getPaymentStatus,
  getPayoutStatus,
  payoutToSeller,
  refundToBuyer,
  findBuyerRefundAddress,
  sweepToOwnerWallet,
  comparePaymentAmount,
  isValidAddress,
  isValidEthAddress: isValidAddress,
  getOwnerWallet,
  getOwnerEthWallet: getOwnerWallet,
  getExplorerTxUrl,
  pingWallet,
  statusLabel,
  loadOrCreateMnemonic,
  addressFromIndex,
  expectedPayWei,
};
