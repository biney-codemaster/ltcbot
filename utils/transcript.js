const {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");
const { formatWhen } = require("./dealLogger");

const { e } = config;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Génère un transcript HTML du salon de deal.
 */
async function buildHtmlTranscript(channel, deal) {
  const messages = [];
  let lastId;
  for (let i = 0; i < 20; i++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (batch.size === 0) break;
    const arr = [...batch.values()];
    messages.push(...arr);
    lastId = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const rows = messages
    .map((msg) => {
      const time = new Date(msg.createdTimestamp).toISOString();
      const author = `${msg.author?.tag || "inconnu"} (${msg.author?.id || "?"})`;
      const content = escapeHtml(msg.content || "").replace(/\n/g, "<br>");
      const embeds =
        msg.embeds?.length > 0
          ? `<div class="embeds">[embed x${msg.embeds.length}]</div>`
          : "";
      const comps =
        msg.components?.length > 0
          ? `<div class="components">[composants Discord]</div>`
          : "";
      const atts =
        msg.attachments?.size > 0
          ? `<div class="files">${[...msg.attachments.values()]
              .map((a) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`)
              .join(", ")}</div>`
          : "";
      return (
        `<div class="msg">` +
        `<div class="meta"><span class="time">${escapeHtml(time)}</span> · ` +
        `<span class="author">${escapeHtml(author)}</span></div>` +
        `<div class="body">${content || "<em>(vide)</em>"}${embeds}${comps}${atts}</div>` +
        `</div>`
      );
    })
    .join("\n");

  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>Transcript Deal #${escapeHtml(deal.deal_code)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;margin:0;padding:24px;line-height:1.45}
  h1,h2{margin:0 0 8px}
  .card{background:#1a1d24;border:1px solid #2a2f3a;border-radius:12px;padding:20px;margin-bottom:20px}
  .muted{color:#9aa0a6}
  .msg{border-top:1px solid #2a2f3a;padding:12px 0}
  .meta{font-size:12px;color:#9aa0a6;margin-bottom:4px}
  .author{color:#8ab4f8}
  a{color:#8ab4f8}
  .kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;margin-top:12px}
  .kv div:nth-child(odd){color:#9aa0a6}
</style>
</head>
<body>
  <div class="card">
    <h1>Transcript — Deal #${escapeHtml(deal.deal_code)}</h1>
    <p class="muted">Généré le ${escapeHtml(formatWhen(new Date().toISOString()))}</p>
    <div class="kv">
      <div>Produit</div><div>${escapeHtml(deal.product)}</div>
      <div>Prix</div><div>${escapeHtml(String(deal.price))}${escapeHtml(deal.currency)}</div>
      <div>Crypto</div><div>${escapeHtml(amount)} ${escapeHtml(deal.crypto || "LTC")}</div>
      <div>Acheteur</div><div>${escapeHtml(deal.buyer_id || "—")}</div>
      <div>Vendeur</div><div>${escapeHtml(deal.seller_id || "—")}</div>
      <div>Statut</div><div>${escapeHtml(deal.status)}</div>
      <div>TXID payout</div><div>${escapeHtml(deal.payout_id || "—")}</div>
      <div>Note</div><div>${escapeHtml(deal.review_rating != null ? `${deal.review_rating}/5` : "—")}</div>
      <div>Avis anonyme</div><div>${deal.review_anonymous ? "oui" : "non"}</div>
    </div>
  </div>
  <div class="card">
    <h2>Messages du salon</h2>
    ${rows || "<p class='muted'>Aucun message.</p>"}
  </div>
</body>
</html>`;

  return {
    filename: `transcript-deal-${deal.deal_code}.html`,
    buffer: Buffer.from(html, "utf8"),
  };
}

function buildTranscriptNoticeContainer(deal, audience) {
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const title =
    audience === "admin"
      ? `${e("staff")}Transcript admin — Deal #${deal.deal_code}`
      : `${e("deal")}Transcript — Deal #${deal.deal_code}`;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Deal clôturé\n` +
        `${e("product")}**Produit** — ${deal.product}\n` +
        `${e("money")}**Prix** — ${deal.price}${deal.currency}\n` +
        `${e("ltc")}**Montant** — \`${amount} ${deal.crypto || "LTC"}\`\n` +
        `${e("buyer")}**Acheteur** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**Vendeur** — <@${deal.seller_id}>\n` +
        `${e("clock")}**Clôturé** — ${formatWhen(deal.completed_at || new Date().toISOString())}\n\n` +
        `${e("info")}Le transcript HTML complet est joint à ce message.\n` +
        `${e("shield")}Conservez ce fichier comme preuve de la transaction.`
    )
  );
  return container;
}

/**
 * Envoie le transcript au salon admin + MP aux deux parties.
 */
async function deliverTranscripts(client, channel, deal) {
  const { filename, buffer } = await buildHtmlTranscript(channel, deal);
  const file = new AttachmentBuilder(buffer, { name: filename });

  if (config.adminLogsChannelId) {
    try {
      const adminCh = await client.channels.fetch(config.adminLogsChannelId);
      if (adminCh?.isTextBased()) {
        await adminCh.send({
          components: [buildTranscriptNoticeContainer(deal, "admin")],
          flags: MessageFlags.IsComponentsV2,
        });
        await adminCh.send({ files: [file] });
      }
    } catch (err) {
      console.warn("Transcript admin:", err.message);
    }
  }

  for (const userId of [deal.buyer_id, deal.seller_id].filter(Boolean)) {
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      await dm.send({
        components: [buildTranscriptNoticeContainer(deal, "user")],
        flags: MessageFlags.IsComponentsV2,
      });
      await dm.send({
        files: [new AttachmentBuilder(buffer, { name: filename })],
      });
    } catch (err) {
      console.warn(`Transcript DM ${userId}:`, err.message);
    }
  }
}

module.exports = {
  buildHtmlTranscript,
  deliverTranscripts,
  buildTranscriptNoticeContainer,
};
