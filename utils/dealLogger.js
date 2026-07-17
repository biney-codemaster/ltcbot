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
  const d = new Date(isoOrSqlite.includes("T") ? isoOrSqlite : `${isoOrSqlite}Z`);
  if (Number.isNaN(d.getTime())) return String(isoOrSqlite);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function sendToChannel(client, channelId, container) {
  if (!client || !channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return null;
    return channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    console.warn(`Log channel ${channelId}:`, err.message);
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
    new TextDisplayBuilder().setContent(lines.filter(Boolean).join("\n"))
  );
  return container;
}

/**
 * Log admin (événements internes : création, paiement, litige, payout, avis…).
 */
async function logAdmin(client, title, lines) {
  return sendToChannel(
    client,
    config.adminLogsChannelId,
    buildAdminLogContainer(title, lines)
  );
}

/**
 * Log public — uniquement deals complétés (prix, date, détails).
 */
async function logPublicCompleted(client, deal) {
  if (!config.publicLogsChannelId) return null;

  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const when = formatWhen(deal.completed_at || deal.review_at || deal.updated_at);
  const rating =
    deal.review_rating != null ? `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - deal.review_rating)}` : "—";

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

  return sendToChannel(client, config.publicLogsChannelId, container);
}

module.exports = {
  logAdmin,
  logPublicCompleted,
  formatWhen,
  buildAdminLogContainer,
};
