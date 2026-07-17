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
    warnings.push("STAFF_ROLE_ID vide → le staff n'aura pas accès aux salons / fermetures");
  }
  const mock =
    String(process.env.ESCROW_MOCK_PAYMENTS || "").toLowerCase() === "true" ||
    process.env.ESCROW_MOCK_PAYMENTS === "1";

  if (!process.env.NOWPAYMENTS_API_KEY && !mock) {
    errors.push("NOWPAYMENTS_API_KEY manquant (création d'adresses LTC impossible)");
  }
  if (!process.env.NOWPAYMENTS_EMAIL || !process.env.NOWPAYMENTS_PASSWORD) {
    if (!mock) {
      warnings.push(
        "NOWPAYMENTS_EMAIL / NOWPAYMENTS_PASSWORD manquants → payout vendeur impossible (Custody)"
      );
    }
  }
  if (!process.env.NOWPAYMENTS_2FA_SECRET && !mock) {
    warnings.push(
      "NOWPAYMENTS_2FA_SECRET manquant → les payouts peuvent rester en attente de 2FA dashboard"
    );
  }
  if (mock) {
    warnings.push("ESCROW_MOCK_PAYMENTS=true → mode test (pas de vrai LTC)");
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
