const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");
const { isUserAnonymous, formatAuthor } = require("./userPrefs");

const { e } = config;

function formatWhen(isoOrSqlite) {
  if (!isoOrSqlite) return "—";
  const raw = String(isoOrSqlite);
  const d = new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Normalise un ID de salon Discord.
 * Accepte: 123..., <#123...>, "123...", avec espaces.
 */
function cleanChannelId(id) {
  if (id == null) return null;
  let s = String(id).trim().replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  s = s.replace(/^['"]+|['"]+$/g, "").trim();
  if (!s) return null;

  const mention = s.match(/^<#(\d{16,22})>$/);
  if (mention) return mention[1];

  s = s.replace(/[<#>]/g, "").trim();
  if (/^\d{16,22}$/.test(s)) return s;

  const embedded = s.match(/(\d{16,22})/);
  if (embedded) return embedded[1];

  return null;
}

function diagnoseChannelEnv(envKey) {
  const raw = process.env[envKey];
  if (raw === undefined) {
    return { ok: false, reason: `clé absente (nom exact requis: ${envKey})` };
  }
  const visible = String(raw).replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (visible.trim() === "") {
    return {
      ok: false,
      reason: "clé présente mais VALEUR VIDE — tu as probablement `ADMIN_LOGS_CHANNEL_ID=` sans rien derrière",
    };
  }
  const cleaned = cleanChannelId(raw);
  if (!cleaned) {
    const preview = visible.trim().slice(0, 48);
    return {
      ok: false,
      reason: `valeur non reconnue comme ID. Reçu (${visible.trim().length} car.): "${preview}"`,
    };
  }
  return { ok: true, id: cleaned };
}

function dumpRelatedEnvKeys() {
  const keys = Object.keys(process.env)
    .filter((k) => /LOG|REVIEW|AVIS|CHANNEL/i.test(k))
    .sort();
  if (keys.length === 0) {
    console.warn("[logs] Aucune variable d'env contenant LOG/REVIEW/CHANNEL trouvée dans process.env");
    return;
  }
  console.log("[logs] Clés d'env liées aux salons détectées:");
  for (const k of keys) {
    const v = process.env[k];
    const len = v == null ? 0 : String(v).trim().length;
    const ok = cleanChannelId(v);
    console.log(`[logs]   - ${k} = ${len === 0 ? "(vide)" : `${len} caractères`} ${ok ? `→ ID OK ${ok}` : "→ NON valide"}`);
  }
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

async function logAdmin(client, title, lines) {
  return sendContainer(
    client,
    config.adminLogsChannelId,
    buildAdminLogContainer(title, lines)
  );
}

function formatFiatParen(deal) {
  const price = deal.price != null ? String(deal.price) : "—";
  if (deal.currency === "$" || deal.currency === "USD") return `($${price})`;
  return `(${price}€)`;
}

async function logPublicCompleted(client, deal) {
  const amount = formatLtcAmount(Number(deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const when = formatWhen(deal.completed_at || deal.review_at || deal.updated_at);

  const buyerAnon =
    deal.review_anonymous != null
      ? Boolean(deal.review_anonymous)
      : isUserAnonymous(deal.buyer_id);
  const sellerAnon = isUserAnonymous(deal.seller_id);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("success")}Deal complété`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("ltc")}${crypto}\n` +
        `\`${amount} ${crypto}\` ${formatFiatParen(deal)}\n\n` +
        `${e("buyer")}**Acheteur** — ${formatAuthor(deal.buyer_id, { anonymous: buyerAnon })}\n` +
        `${e("seller")}**Vendeur** — ${formatAuthor(deal.seller_id, { anonymous: sellerAnon })}\n\n` +
        `${e("clock")}${when}`
    )
  );

  return sendContainer(client, config.publicLogsChannelId, container);
}

/** Ping des salons logs au démarrage (diagnostic détaillé). */
async function probeLogChannels(client) {
  dumpRelatedEnvKeys();

  const targets = [
    ["ADMIN_LOGS_CHANNEL_ID", ["ADMIN_LOGS_CHANNEL_ID", "ADMIN_LOG_CHANNEL_ID", "LOGS_ADMIN_CHANNEL_ID"]],
    ["PUBLIC_LOGS_CHANNEL_ID", ["PUBLIC_LOGS_CHANNEL_ID", "PUBLIC_LOG_CHANNEL_ID", "LOGS_PUBLIC_CHANNEL_ID"]],
    ["REVIEWS_CHANNEL_ID", ["REVIEWS_CHANNEL_ID", "REVIEW_CHANNEL_ID", "AVIS_CHANNEL_ID"]],
  ];

  console.log("[logs] Diagnostic .env salons:");
  for (const [label, keys] of targets) {
    let diag = { ok: false, reason: "aucune clé trouvée" };
    let usedKey = label;
    for (const key of keys) {
      if (process.env[key] === undefined) continue;
      const d = diagnoseChannelEnv(key);
      diag = d;
      usedKey = key;
      if (d.ok) break;
    }
    if (!diag.ok) {
      console.warn(`[logs] ${label} → ${diag.reason}`);
      continue;
    }
    try {
      const ch = await client.channels.fetch(diag.id);
      console.log(`[logs] ${usedKey} OK → #${ch.name} (${diag.id})`);
    } catch (err) {
      console.error(
        `[logs] ${usedKey} ID lu (${diag.id}) mais salon inaccessible: ${err.message}`
      );
      console.error(
        "[logs] → permissions bot sur le salon, ou mauvais ID (salon vs serveur)"
      );
    }
  }

  const adminId =
    cleanChannelId(process.env.ADMIN_LOGS_CHANNEL_ID) ||
    cleanChannelId(process.env.ADMIN_LOG_CHANNEL_ID) ||
    cleanChannelId(process.env.LOGS_ADMIN_CHANNEL_ID);

  config.adminLogsChannelId = adminId;
  config.publicLogsChannelId =
    cleanChannelId(process.env.PUBLIC_LOGS_CHANNEL_ID) ||
    cleanChannelId(process.env.PUBLIC_LOG_CHANNEL_ID) ||
    cleanChannelId(process.env.LOGS_PUBLIC_CHANNEL_ID);
  config.reviewsChannelId =
    cleanChannelId(process.env.REVIEWS_CHANNEL_ID) ||
    cleanChannelId(process.env.REVIEW_CHANNEL_ID) ||
    cleanChannelId(process.env.AVIS_CHANNEL_ID);

  if (adminId) {
    await logAdmin(client, "Bot démarré", [
      `Bot connecté — logs admin opérationnels.`,
      `Public logs: ${config.publicLogsChannelId ? "OK" : "non configuré"}`,
      `Reviews: ${config.reviewsChannelId ? "OK" : "non configuré"}`,
    ]);
  } else {
    console.warn(
      "[logs] Aucun ID admin valide dans process.env.\n" +
        "Ouvre le fichier .env DANS le serveur HostMaster et vérifie ces lignes EXACTES:\n" +
        "ADMIN_LOGS_CHANNEL_ID=123456789012345678\n" +
        "PUBLIC_LOGS_CHANNEL_ID=123456789012345678\n" +
        "REVIEWS_CHANNEL_ID=123456789012345678"
    );
  }
}

module.exports = {
  logAdmin,
  logPublicCompleted,
  formatWhen,
  probeLogChannels,
  cleanChannelId,
  diagnoseChannelEnv,
  buildAdminLogContainer,
};
