const {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ComponentType,
  ButtonStyle,
} = require("discord.js");
const config = require("../config");
const { discordTimestamp, dealCodeTag } = require("./dealLogger");

const { e } = config;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Remplace <:name:id> / <a:name:id> par des images CDN Discord. */
function replaceDiscordEmojis(text) {
  return String(text || "").replace(
    /<(a)?:([\w]+):(\d+)>/g,
    (_m, animated, name, id) => {
      const ext = animated ? "gif" : "png";
      const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=48&quality=lossless`;
      return `<img class="emoji" src="${url}" alt=":${name}:" title=":${name}:" draggable="false"/>`;
    }
  );
}

function markdownLiteToHtml(text) {
  // Emojis d'abord (avant escape), puis placeholders pour les protéger
  const withEmoji = replaceDiscordEmojis(text || "");
  const parts = [];
  const masked = withEmoji.replace(/<img class="emoji"[^>]+>/g, (img) => {
    const i = parts.length;
    parts.push(img);
    return `\u0000EMOJI${i}\u0000`;
  });

  let s = escapeHtml(masked);
  s = s.replace(/\n/g, "<br>");
  s = s.replace(/(^|<br>)#\s+(.+?)(?=<br>|$)/g, "$1<h3 class='md-h'>$2</h3>");
  s = s.replace(/(^|<br>)##\s+(.+?)(?=<br>|$)/g, "$1<h4 class='md-h'>$2</h4>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\u0000EMOJI(\d+)\u0000/g, (_m, i) => parts[Number(i)] || "");
  return s;
}

function buttonStyleClass(style) {
  switch (Number(style)) {
    case ButtonStyle.Primary:
    case 1:
      return "btn btn-primary";
    case ButtonStyle.Success:
    case 3:
      return "btn btn-success";
    case ButtonStyle.Danger:
    case 4:
      return "btn btn-danger";
    case ButtonStyle.Link:
    case 5:
      return "btn btn-link";
    default:
      return "btn btn-secondary";
  }
}

function renderButtonEmoji(emoji) {
  if (!emoji) return "";
  if (emoji.id) {
    const ext = emoji.animated ? "gif" : "png";
    const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=32&quality=lossless`;
    const name = escapeHtml(emoji.name || "emoji");
    return `<img class="emoji" src="${url}" alt=":${name}:"/> `;
  }
  if (emoji.name) return `${escapeHtml(emoji.name)} `;
  return "";
}

function renderButton(btn) {
  const data = btn.data || btn;
  const label = escapeHtml(data.label || "Bouton");
  const disabled = data.disabled ? " disabled" : "";
  const cls = buttonStyleClass(data.style);
  const emoji = renderButtonEmoji(data.emoji);
  if (data.style === ButtonStyle.Link || data.url) {
    return `<a class="${cls}${disabled}" href="${escapeHtml(data.url || "#")}">${emoji}${label}</a>`;
  }
  return `<span class="${cls}${disabled}">${emoji}${label}</span>`;
}

function renderSelect(select) {
  const data = select.data || select;
  const placeholder = escapeHtml(data.placeholder || "Sélection");
  const options = (data.options || [])
    .map((o) => `<option>${escapeHtml(o.label || o.value || "")}</option>`)
    .join("");
  return (
    `<div class="select-wrap">` +
    `<select disabled><option>${placeholder}</option>${options}</select>` +
    `</div>`
  );
}

function renderActionRow(row) {
  const kids = row.components || [];
  const inner = kids
    .map((c) => {
      const type = c.type ?? c.data?.type;
      if (type === ComponentType.Button || type === 2) return renderButton(c);
      if (
        type === ComponentType.StringSelect ||
        type === ComponentType.UserSelect ||
        type === ComponentType.RoleSelect ||
        type === ComponentType.MentionableSelect ||
        type === ComponentType.ChannelSelect ||
        type === 3 ||
        type === 5 ||
        type === 6 ||
        type === 7 ||
        type === 8
      ) {
        return renderSelect(c);
      }
      return "";
    })
    .join("");
  return inner ? `<div class="action-row">${inner}</div>` : "";
}

function renderTextDisplay(comp) {
  const content = comp.data?.content ?? comp.content ?? "";
  return `<div class="text-display">${markdownLiteToHtml(content)}</div>`;
}

function renderSeparator() {
  return `<hr class="sep"/>`;
}

function renderComponent(comp) {
  const type = comp.type ?? comp.data?.type;
  if (type === ComponentType.Container || type === 17) {
    const kids = (comp.components || []).map(renderComponent).join("");
    return `<div class="v2-container">${kids}</div>`;
  }
  if (type === ComponentType.TextDisplay || type === 10) {
    return renderTextDisplay(comp);
  }
  if (type === ComponentType.Separator || type === 14) {
    return renderSeparator();
  }
  if (type === ComponentType.ActionRow || type === 1) {
    return renderActionRow(comp);
  }
  if (type === ComponentType.Section || type === 9) {
    const kids = (comp.components || []).map(renderComponent).join("");
    return `<div class="section">${kids}</div>`;
  }
  if (type === ComponentType.MediaGallery || type === 12) {
    return `<div class="muted">[galerie média]</div>`;
  }
  if (type === ComponentType.File || type === 13) {
    return `<div class="muted">[fichier]</div>`;
  }
  // Legacy action rows without explicit type
  if (Array.isArray(comp.components) && comp.components.some((c) => (c.type ?? c.data?.type) === 2)) {
    return renderActionRow(comp);
  }
  return "";
}

function renderMessageBody(msg) {
  const parts = [];
  if (msg.content) {
    parts.push(`<div class="plain">${markdownLiteToHtml(msg.content)}</div>`);
  }
  if (msg.embeds?.length) {
    for (const emb of msg.embeds) {
      const title = emb.title ? `<div class="embed-title">${escapeHtml(emb.title)}</div>` : "";
      const desc = emb.description
        ? `<div class="embed-desc">${markdownLiteToHtml(emb.description)}</div>`
        : "";
      parts.push(`<div class="embed">${title}${desc}</div>`);
    }
  }
  if (msg.components?.length) {
    for (const top of msg.components) {
      parts.push(renderComponent(top));
    }
  }
  if (msg.attachments?.size > 0) {
    const files = [...msg.attachments.values()]
      .map((a) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`)
      .join(", ");
    parts.push(`<div class="files">${files}</div>`);
  }
  if (parts.length === 0) {
    return `<em class="muted">(vide)</em>`;
  }
  return parts.join("");
}

/**
 * Transcript HTML = le ticket tel quel (containers + boutons), sans fiche résumé.
 */
async function buildHtmlTranscript(channel, deal) {
  const messages = [];
  let lastId;
  for (let i = 0; i < 20; i++) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });
    if (batch.size === 0) break;
    const arr = [...batch.values()];
    messages.push(...arr);
    lastId = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const rows = messages
    .map((msg) => {
      const time = new Date(msg.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
      const author = escapeHtml(msg.author?.tag || msg.author?.username || "inconnu");
      const botBadge = msg.author?.bot ? `<span class="bot">BOT</span>` : "";
      return (
        `<div class="msg">` +
        `<div class="meta">` +
        `<span class="author">${author}</span>${botBadge}` +
        `<span class="time">${escapeHtml(time)} UTC</span>` +
        `</div>` +
        `<div class="body">${renderMessageBody(msg)}</div>` +
        `</div>`
      );
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<title>Deal #${escapeHtml(deal.deal_code)}</title>
<style>
  :root{
    --bg:#313338; --panel:#2b2d31; --elev:#1e1f22; --text:#dbdee1; --muted:#949ba4;
    --accent:#5865f2; --success:#248046; --danger:#da373c; --secondary:#4e5058;
    --border:#3f4147; --code:#1e1f22;
  }
  *{box-sizing:border-box}
  body{font-family:gg sans,Noto Sans,Helvetica Neue,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:20px 16px 40px;line-height:1.375;font-size:15px}
  .ticket{max-width:720px;margin:0 auto}
  .msg{padding:10px 8px;border-radius:4px}
  .msg:hover{background:rgba(0,0,0,.06)}
  .meta{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
  .author{font-weight:600;color:#fff}
  .bot{font-size:10px;font-weight:700;background:var(--accent);color:#fff;border-radius:3px;padding:1px 4px;margin-left:4px}
  .time{font-size:11px;color:var(--muted);margin-left:auto}
  .body{color:var(--text)}
  .plain{white-space:pre-wrap}
  .muted{color:var(--muted)}
  .v2-container{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin:8px 0}
  .text-display{margin:4px 0}
  img.emoji{width:1.375em;height:1.375em;object-fit:contain;vertical-align:-0.3em;display:inline}
  .md-h{margin:6px 0 4px;color:#fff;font-weight:700}
  h3.md-h{font-size:18px} h4.md-h{font-size:15px}
  code{background:var(--code);padding:1px 4px;border-radius:3px;font-size:13px}
  .sep{border:0;border-top:1px solid var(--border);margin:10px 0}
  .action-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .btn{display:inline-flex;align-items:center;gap:4px;border:none;border-radius:3px;padding:6px 12px;font-size:13px;font-weight:500;color:#fff;text-decoration:none;cursor:default;user-select:none}
  .btn.disabled{opacity:.5}
  .btn-primary{background:var(--accent)}
  .btn-success{background:var(--success)}
  .btn-danger{background:var(--danger)}
  .btn-secondary,.btn-link{background:var(--secondary)}
  .select-wrap select{background:var(--elev);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:6px 10px;min-width:180px}
  .embed{background:var(--elev);border-left:3px solid var(--accent);border-radius:4px;padding:8px 12px;margin:6px 0}
  .embed-title{font-weight:700;margin-bottom:4px}
  .files{margin-top:6px;font-size:13px}
  .files a{color:#00a8fc}
</style>
</head>
<body>
  <div class="ticket">
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
  const title =
    audience === "admin"
      ? `${e("staff")}Transcript — Deal #${dealCodeTag(deal.deal_code)}`
      : `${e("deal")}Transcript — Deal #${dealCodeTag(deal.deal_code)}`;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("success")}Deal clôturé — ${discordTimestamp(deal.completed_at || new Date().toISOString())}\n\n` +
        `${e("info")}Le fichier HTML joint reprend le **ticket tel quel** (messages, containers, boutons).\n` +
        `${e("shield")}Conserve-le comme preuve.`
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
