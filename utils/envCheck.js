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
  if (!process.env.BLOCKBEE_API_KEY) {
    errors.push("BLOCKBEE_API_KEY manquant (API Key V2 BlockBee requise)");
  }
  if (!process.env.BLOCKBEE_LTC_ADDRESS) {
    warnings.push(
      "BLOCKBEE_LTC_ADDRESS vide → le bot tentera de récupérer l'adresse SCW via l'API BlockBee"
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
