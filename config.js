// Parse un emoji custom Discord "<:nom:id>" ou "<a:nom:id>" en objet utilisable
// par setEmoji(). Accepte null (emoji pas encore défini) sans planter.
function parseEmoji(raw) {
  if (!raw) return null;
  const match = raw.match(/^<(a)?:([\w]+):(\d+)>$/);
  if (!match) return null;
  const [, animated, name, id] = match;
  return { id, name, animated: !!animated };
}

// Emojis persos du serveur — mets null tant que tu n'as pas l'ID,
// ou "<:nom:id>" (copie-colle exact, tape \:nomemoji: dans un salon) une fois prêt.
// Aucun emoji Unicode : uniquement des emojis custom Discord.
const rawEmojis = {
  // Général / navigation
  info: null, // infos, messages système
  success: null, // validation, succès
  warning: null, // attention, rôles incorrects
  error: null, // erreur, échec
  cancel: null, // annulation
  confirm: null, // confirmation
  close: null, // fermeture de salon
  next: null, // prochaine étape
  lock: null, // salon privé / sécurité
  staff: null, // médiation / staff
  clock: null, // en attente

  // Escrow / deal
  escrow: null, // panneau principal + bouton déco (mets "<:nom:id>" pour l'afficher)
  deal: null, // deal / transaction
  shield: null, // confiance / protection des fonds
  roles: null, // sélection des rôles
  buyer: null, // rôle acheteur
  seller: null, // rôle vendeur
  product: null, // produit échangé
  users: null, // participants

  // Paiement
  money: null, // montant fiat
  crypto: null, // crypto générique
  usd: "<:emoji_21:1527831343273345024>", // dollar $
  eur: "<:emoji_22:1527831361107529848>", // euro €
  ltc: "<:emojigg_ltc:1527807573493809203>", // Litecoin
  wallet: null, // adresse / portefeuille
  payment: null, // paiement en cours
  release: null, // libération des fonds
  dispute: null, // litige
};

const emojis = {};
for (const [key, value] of Object.entries(rawEmojis)) {
  emojis[key] = parseEmoji(value); // objet {id, name, animated} ou null si pas configuré
}

// Version texte "<:nom:id>" utilisable directement dans un TextDisplay (vide si null)
const emojiText = {};
for (const [key, value] of Object.entries(rawEmojis)) {
  emojiText[key] = parseEmoji(value) ? value : "";
}

/** Préfixe emoji + espace, ou chaîne vide si non configuré (évite les espaces orphelins). */
function e(key) {
  return emojiText[key] ? `${emojiText[key]} ` : "";
}

function readChannelId(...envKeys) {
  for (const envKey of envKeys) {
    const raw = process.env[envKey];
    if (raw == null) continue;
    let s = String(raw).trim().replace(/^['"]+|['"]+$/g, "").trim();
    // enlève BOM / caractères invisibles fréquents
    s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
    if (!s) continue;
    const mention = s.match(/^<#(\d{16,22})>$/);
    if (mention) return mention[1];
    s = s.replace(/[<#>]/g, "").trim();
    if (/^\d{16,22}$/.test(s)) return s;
    const embedded = s.match(/(\d{16,22})/);
    if (embedded) return embedded[1];
  }
  return null;
}

/** Salon du panel /howto — lu à chaque appel (évite un .env chargé trop tôt / oubli de restart). */
function getHowtoChannelId() {
  return readChannelId(
    "HOWTO_CHANNEL_ID",
    "HOW_TO_USE_CHANNEL_ID",
    "HOWTO_USE_CHANNEL_ID",
    "HOW_TO_CHANNEL_ID"
  );
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // pour enregistrer les commandes en dev (instant), sinon global
  staffRoleId: process.env.STAFF_ROLE_ID, // rôle staff/médiateur ayant accès aux salons de deal
  /** Role given silently after a completed deal review. */
  customerRoleId: (() => {
    const raw = String(process.env.CUSTOMER_ROLE_ID || "").trim();
    if (!raw) return null;
    const m = raw.match(/(\d{16,22})/);
    return m ? m[1] : null;
  })(),
  /** Seed BIP39 du wallet HD escrow (sinon fichier wallet.mnemonic auto-créé). */
  ltcWalletMnemonic: (process.env.LTC_WALLET_MNEMONIC || "").trim() || null,

  /** Salons Discord (IDs numériques). Alias acceptés pour éviter les typos .env */
  adminLogsChannelId: readChannelId(
    "ADMIN_LOGS_CHANNEL_ID",
    "ADMIN_LOG_CHANNEL_ID",
    "LOGS_ADMIN_CHANNEL_ID"
  ),
  publicLogsChannelId: readChannelId(
    "PUBLIC_LOGS_CHANNEL_ID",
    "PUBLIC_LOG_CHANNEL_ID",
    "LOGS_PUBLIC_CHANNEL_ID"
  ),
  reviewsChannelId: readChannelId(
    "REVIEWS_CHANNEL_ID",
    "REVIEW_CHANNEL_ID",
    "AVIS_CHANNEL_ID"
  ),
  get howtoChannelId() {
    return getHowtoChannelId();
  },
  getHowtoChannelId,
  readChannelId,

  emojis, // objets, pour .setEmoji()
  emojiText, // strings, pour le texte des messages
  e, // helper d'affichage: e("deal") => "<:deal:id> " ou ""
};
