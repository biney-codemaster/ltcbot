const fs = require("fs");
const path = require("path");
const bip39 = require("bip39");

const WALLET_FILE = path.join(__dirname, "..", "wallet.mnemonic");

let mnemonicCached = null;

/**
 * Seed partagée pour LTC / BTC / ETH / SOL.
 * Priorité: CRYPTO_WALLET_MNEMONIC → LTC_WALLET_MNEMONIC → wallet.mnemonic → auto-create.
 */
function loadOrCreateMnemonic() {
  if (mnemonicCached) return mnemonicCached;

  const fromEnv = (
    process.env.CRYPTO_WALLET_MNEMONIC ||
    process.env.LTC_WALLET_MNEMONIC ||
    ""
  ).trim();
  if (fromEnv) {
    if (!bip39.validateMnemonic(fromEnv)) {
      throw new Error("CRYPTO/LTC_WALLET_MNEMONIC invalide (seed BIP39)");
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
  console.warn("NOUVEAU WALLET CRYPTO CRÉÉ — SAUVEGARDE CETTE SEED MAINTENANT");
  console.warn(mnemonic);
  console.warn(`Aussi écrite dans ${WALLET_FILE}`);
  console.warn("Sans cette seed, les fonds escrow sont PERDUS.");
  console.warn("======================================================");
  mnemonicCached = mnemonic;
  return mnemonicCached;
}

module.exports = { loadOrCreateMnemonic, WALLET_FILE };
