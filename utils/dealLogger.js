const { EmbedBuilder } = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");

function formatWhen(isoOrSqlite) {
  if (!isoOrSqlite) return "—";
  const raw = String(isoOrSqlite);
  const d = new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function cleanChannelId(id) {
  if (!id) return null;
  const cleaned = String(id).trim().replace(/[<#>]/g, "");
  return /^\d{17,20}$/.test(cleaned) ? cleaned : null;
}

async function sendEmbed(client, channelId, embed) {
  const id = cleanChannelId(channelId);
  if (!client) {
    console.warn("[logs] client manquant");
    return null;
  }
  if (!id) {
    console.warn("[logs] channel ID invalide ou vide:", channelId);
    return null;
  }

  try {
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased()) {
      console.warn(`[logs] salon ${id} introuvable ou non textuel`);
      return null;
    }
    const msg = await channel.send({ embeds: [embed] });
    console.log(`[logs] OK → #${channel.name || id}`);
    return msg;
  } catch (err) {
    console.error(`[logs] Échec envoi salon ${id}:`, err.message);
    return null;
  }
}

/**
 * Log admin (événements internes).
 */
async function logAdmin(client, title, lines) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛡 ${title}`)
    .setDescription(lines.filter(Boolean).join("\n").slice(0, 4000) || "—")
    .setTimestamp();

  return sendEmbed(client, config.adminLogsChannelId, embed);
}

/**
 * Log public — deals complétés uniquement.
 */
async function logPublicCompleted(client, deal) {
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const when = formatWhen(deal.completed_at || deal.review_at || deal.updated_at);
  const rating =
    deal.review_rating != null
      ? `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - deal.review_rating)} (${deal.review_rating}/5)`
      : "—";

  const parties = deal.review_anonymous
    ? "Parties anonymisées"
    : `Acheteur: <@${deal.buyer_id}>\nVendeur: <@${deal.seller_id}>`;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ Deal complété #${deal.deal_code}`)
    .addFields(
      { name: "Produit", value: String(deal.product || "—").slice(0, 1024), inline: true },
      { name: "Prix", value: `${deal.price}${deal.currency}`, inline: true },
      { name: "Crypto", value: `\`${amount} ${deal.crypto || "LTC"}\``, inline: true },
      { name: "Date", value: when, inline: true },
      { name: "Note", value: rating, inline: true },
      { name: "Participants", value: parties, inline: false }
    )
    .setTimestamp();

  return sendEmbed(client, config.publicLogsChannelId, embed);
}

/** Ping des salons logs au démarrage (diagnostic). */
async function probeLogChannels(client) {
  const targets = [
    ["ADMIN_LOGS_CHANNEL_ID", config.adminLogsChannelId],
    ["PUBLIC_LOGS_CHANNEL_ID", config.publicLogsChannelId],
    ["REVIEWS_CHANNEL_ID", config.reviewsChannelId],
  ];

  for (const [name, raw] of targets) {
    const id = cleanChannelId(raw);
    if (!id) {
      console.warn(`[logs] ${name} non configuré`);
      continue;
    }
    try {
      const ch = await client.channels.fetch(id);
      console.log(`[logs] ${name} OK → #${ch.name} (${id})`);
    } catch (err) {
      console.error(`[logs] ${name} KO (${id}): ${err.message}`);
    }
  }

  if (config.adminLogsChannelId) {
    await logAdmin(client, "Bot démarré", [
      `Bot connecté — logs admin opérationnels.`,
      `Public logs: ${cleanChannelId(config.publicLogsChannelId) ? "OK" : "non configuré"}`,
      `Reviews: ${cleanChannelId(config.reviewsChannelId) ? "OK" : "non configuré"}`,
    ]);
  }
}

module.exports = {
  logAdmin,
  logPublicCompleted,
  formatWhen,
  probeLogChannels,
  cleanChannelId,
};
