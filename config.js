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
  info: "<:info:1528496243779698839>",
  success: "<:success:1528497568374325382>",
  warning: "<:warning:1528498348544491572>",
  error: "<:error:1528497725325447268>",
  cancel: "<:cancel:1528498548289835112>",
  confirm: "<:confirm:1528497150957195404>",
  close: "<:close:1528497782502199306>",
  next: "<:next:1528498418450960394>",
  lock: "<:lock:1528496930966081717>",
  staff: "<:staff:1528497065879929013>",
  clock: "<:clock:1528496988956397618>",

  // Escrow / deal
  escrow: "<:escrow:1527805147651248321>",
  deal: "<:deal:1528497243332677815>",
  shield: "<:shield:1528497831189680220>",
  roles: "<:roles:1528497672015708220>",
  buyer: "<:customer:1528496834308341860>", // customer
  seller: "<:seller:1528496886686810353>",
  product: "<:package:1528498614605840434>", // package
  users: "<:users:1528496055505784924>",

  // Paiement
  money: "<:money:1528496636240728284>",
  crypto: "<:crypto:1528498733258510516>",
  usd: "<:dollar:1528498650706084012>",
  eur: "<:euro:1528498501758091334>",
  ltc: "<:ltc:1528495999956287558>",
  wallet: "<:wallet:1528497115444019301>",
  payment: "<:payment:1528496762866761810>",
  release: "<:release:1528496366253510827>",
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

/** Role given silently after a completed deal review (live read). */
function getCustomerRoleId() {
  const raw = String(process.env.CUSTOMER_ROLE_ID || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{16,22})/);
  return m ? m[1] : null;
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // pour enregistrer les commandes en dev (instant), sinon global
  staffRoleId: process.env.STAFF_ROLE_ID, // rôle staff/médiateur ayant accès aux salons de deal
  getCustomerRoleId,
  get customerRoleId() {
    return getCustomerRoleId();
  },
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
