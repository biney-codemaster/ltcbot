/**
 * Vérifie que les variables d'environnement critiques sont présentes.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  if (!process.env.DISCORD_TOKEN) errors.push("DISCORD_TOKEN manquant");
  if (!process.env.CLIENT_ID) errors.push("CLIENT_ID manquant");
  if (!process.env.GUILD_ID) {
    warnings.push("GUILD_ID vide → commandes globales (plus lentes à propager)");
  }
  if (!process.env.STAFF_ROLE_ID) {
    warnings.push("STAFF_ROLE_ID empty → staff may lack deal channel access");
  }
  {
    const raw = String(process.env.CUSTOMER_ROLE_ID || "").trim();
    if (!raw) {
      warnings.push("CUSTOMER_ROLE_ID empty → no role assigned after deal reviews");
    } else if (!/\d{16,22}/.test(raw)) {
      warnings.push(
        `CUSTOMER_ROLE_ID invalid ("${raw.slice(0, 32)}") → must be the role snowflake ID`
      );
    }
  }
  if (!process.env.CRYPTO_WALLET_MNEMONIC && !process.env.LTC_WALLET_MNEMONIC) {
    warnings.push(
      "CRYPTO/LTC_WALLET_MNEMONIC vide → le bot utilisera / créera wallet.mnemonic (SAUVEGARDE-LE)"
    );
  }
  for (const coin of ["LTC", "BTC", "ETH", "SOL"]) {
    if (!String(process.env[`OWNER_${coin}_WALLET`] || "").trim()) {
      warnings.push(
        `OWNER_${coin}_WALLET vide → sous/surpaiements ${coin} ne pourront pas être routés`
      );
    }
  }
  if (!process.env.ADMIN_LOGS_CHANNEL_ID) {
    warnings.push("ADMIN_LOGS_CHANNEL_ID vide → pas de logs admin / transcripts");
  }
  if (!process.env.PUBLIC_LOGS_CHANNEL_ID) {
    warnings.push("PUBLIC_LOGS_CHANNEL_ID vide → pas de logs publics des deals complétés");
  }
  if (!process.env.REVIEWS_CHANNEL_ID) {
    warnings.push("REVIEWS_CHANNEL_ID vide → les avis ne seront pas publiés");
  }
  if (!String(process.env.HOWTO_CHANNEL_ID || "").trim()) {
    warnings.push(
      "HOWTO_CHANNEL_ID empty → /setup How to use button needs it (or howto_channel option)"
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

function logEnvValidation() {
  const { ok, errors, warnings } = validateEnv();
  for (const w of warnings) console.warn(`[config] ${w}`);
  for (const e of errors) console.error(`[config] ${e}`);
  if (!ok) {
    console.error("[config] Corrige le .env puis relance le bot.");
  }
  return ok;
}

module.exports = { validateEnv, logEnvValidation };
