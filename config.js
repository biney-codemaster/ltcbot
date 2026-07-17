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
  escrow: null, // panneau principal escrow
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
  ltc: null, // Litecoin
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

function readChannelId(envKey) {
  const raw = process.env[envKey];
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^['"]+|['"]+$/g, "").trim();
  if (!s) return null;
  const mention = s.match(/^<#(\d{17,20})>$/);
  if (mention) return mention[1];
  s = s.replace(/[<#>]/g, "").trim();
  if (/^\d{17,20}$/.test(s)) return s;
  const embedded = s.match(/(\d{17,20})/);
  return embedded ? embedded[1] : null;
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // pour enregistrer les commandes en dev (instant), sinon global
  staffRoleId: process.env.STAFF_ROLE_ID, // rôle staff/médiateur ayant accès aux salons de deal
  /** Seed BIP39 du wallet HD escrow (sinon fichier wallet.mnemonic auto-créé). */
  ltcWalletMnemonic: (process.env.LTC_WALLET_MNEMONIC || "").trim() || null,

  /** Salons Discord (IDs numériques uniquement). */
  adminLogsChannelId: readChannelId("ADMIN_LOGS_CHANNEL_ID"),
  publicLogsChannelId: readChannelId("PUBLIC_LOGS_CHANNEL_ID"),
  reviewsChannelId: readChannelId("REVIEWS_CHANNEL_ID"),

  emojis, // objets, pour .setEmoji()
  emojiText, // strings, pour le texte des messages
  e, // helper d'affichage: e("deal") => "<:deal:id> " ou ""
};
