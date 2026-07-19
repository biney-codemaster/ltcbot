const { PermissionFlagsBits } = require("discord.js");
const config = require("../config");

const { e } = config;

const PREFIX = "+emoji";

function isStaffOrManage(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const raw = String(config.staffRoleId || process.env.STAFF_ROLE_ID || "").trim();
  const m = raw.match(/(\d{16,22})/);
  return Boolean(m && member.roles?.cache?.has(m[1]));
}

/** Formate un emoji guild en ligne copiable (\:nom: + markdown config). */
function formatEmojiLine(emoji) {
  const animated = emoji.animated ? "a" : "";
  const full = `<${animated}:${emoji.name}:${emoji.id}>`;
  return `\\:${emoji.name}: → \`${full}\``;
}

function chunkLines(lines, maxLen = 1900) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Commande préfixe: +emoji
 * Liste tous les emojis custom du serveur, un par ligne, avec \:nom:
 */
async function handleEmojiListMessage(message) {
  const content = String(message.content || "").trim();
  if (content.toLowerCase() !== PREFIX) return false;

  if (!message.guild) {
    await message.reply(`${e("error")}Use \`+emoji\` in a server.`);
    return true;
  }

  if (!isStaffOrManage(message.member)) {
    await message.reply(
      `${e("error")}Only staff / **Manage Server** can use \`+emoji\`.`
    );
    return true;
  }

  const emojis = [...message.guild.emojis.cache.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  if (emojis.length === 0) {
    await message.reply(`${e("warning")}No custom emojis on this server.`);
    return true;
  }

  const lines = emojis.map(formatEmojiLine);
  const header =
    `${e("success")}**${emojis.length} server emoji(s)** — copy the \`:name:\` lines or the \`<:name:id>\` for \`config.js\`:\n`;

  const chunks = chunkLines(lines);
  await message.reply({
    content: `${header}\`\`\`\n${chunks[0]}\n\`\`\``,
    allowedMentions: { parse: [] },
  });

  for (let i = 1; i < chunks.length; i++) {
    await message.channel.send({
      content: `\`\`\`\n${chunks[i]}\n\`\`\``,
      allowedMentions: { parse: [] },
    });
  }

  return true;
}

module.exports = { handleEmojiListMessage, PREFIX };
