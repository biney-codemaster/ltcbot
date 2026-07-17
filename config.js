// Parse un emoji custom Discord "<:nom:id>" ou "<a:nom:id>" en objet utilisable
// par setEmoji(). Accepte null (emoji pas encore défini) sans planter.
function parseEmoji(raw) {
  if (!raw) return null;
  const match = raw.match(/^<(a)?:(\w+):(\d+)>$/);
  if (!match) return null;
  const [, animated, name, id] = match;
  return { id, name, animated: !!animated };
}

// Emojis persos du serveur — mets null tant que tu n'as pas l'ID,
// ou "<:nom:id>" (copie-colle exact, tape \:nomemoji: dans un salon) une fois prêt.
const rawEmojis = {
  info: null,
  deal: null,
  money: null,
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

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID, // pour enregistrer les commandes en dev (instant), sinon global
  staffRoleId: process.env.STAFF_ROLE_ID, // rôle staff/médiateur ayant accès aux salons de deal

  emojis, // objets, pour .setEmoji()
  emojiText, // strings, pour le texte des messages
};
