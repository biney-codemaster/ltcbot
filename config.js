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

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // pour enregistrer les commandes en dev (instant), sinon global
  staffRoleId: process.env.STAFF_ROLE_ID, // rôle staff/médiateur ayant accès aux salons de deal
  nowpaymentsApiKey: process.env.NOWPAYMENTS_API_KEY,
  nowpaymentsIpnUrl: process.env.NOWPAYMENTS_IPN_URL || null, // optionnel (webhook public)
  // Requis pour payout Custody → vendeur
  nowpaymentsEmail: process.env.NOWPAYMENTS_EMAIL || null,
  nowpaymentsPassword: process.env.NOWPAYMENTS_PASSWORD || null,
  // Optionnel: secret TOTP (app 2FA) pour valider les payouts automatiquement
  nowpayments2faSecret: process.env.NOWPAYMENTS_2FA_SECRET || null,

  emojis, // objets, pour .setEmoji()
  emojiText, // strings, pour le texte des messages
  e, // helper d'affichage: e("deal") => "<:deal:id> " ou ""
};
