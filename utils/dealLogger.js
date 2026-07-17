const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");

const { e } = config;

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

async function sendContainer(client, channelId, container) {
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
    const msg = await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    console.log(`[logs] OK → #${channel.name || id}`);
    return msg;
  } catch (err) {
    console.error(`[logs] Échec envoi salon ${id}:`, err.message);
    return null;
  }
}

function buildAdminLogContainer(title, lines) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("staff")}${title}`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.filter(Boolean).join("\n") || "—")
  );
  return container;
}

/**
 * Log admin (événements internes).
 */
async function logAdmin(client, title, lines) {
  return sendContainer(
    client,
    config.adminLogsChannelId,
    buildAdminLogContainer(title, lines)
  );
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

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("success")}Deal complété`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}#${deal.deal_code}\n` +
        `${e("product")}**Produit** — ${deal.product}\n` +
        `${e("money")}**Prix** — ${deal.price}${deal.currency}\n` +
        `${e("ltc")}**Crypto** — \`${amount} ${deal.crypto || "LTC"}\`\n` +
        `${e("clock")}**Date** — ${when}\n` +
        `${e("confirm")}**Note** — ${rating}\n` +
        (deal.review_anonymous
          ? `${e("users")}**Parties** — anonymisées`
          : `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
            `${e("seller")}**Vendeur** — <@${deal.seller_id}>`)
    )
  );

  return sendContainer(client, config.publicLogsChannelId, container);
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

  if (cleanChannelId(config.adminLogsChannelId)) {
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
  buildAdminLogContainer,
};
