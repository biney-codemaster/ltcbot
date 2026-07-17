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

/**
 * Normalise un ID de salon Discord.
 * Accepte: 123..., <#123...>, "123...", avec espaces.
 */
function cleanChannelId(id) {
  if (id == null) return null;
  let s = String(id).trim();
  if (!s) return null;

  // Enlève guillemets éventuels
  s = s.replace(/^['"]+|['"]+$/g, "").trim();

  // <#123456789012345678>
  const mention = s.match(/^<#(\d{17,20})>$/);
  if (mention) return mention[1];

  // Garde uniquement les chiffres si le reste est du bruit
  s = s.replace(/[<#>]/g, "").trim();
  if (/^\d{17,20}$/.test(s)) return s;

  // Dernier recours: extraire un snowflake dans la chaîne
  const embedded = s.match(/(\d{17,20})/);
  if (embedded) return embedded[1];

  return null;
}

function diagnoseChannelEnv(envKey) {
  const raw = process.env[envKey];
  if (raw === undefined) {
    return { ok: false, reason: `clé absente du .env (nom exact: ${envKey})` };
  }
  if (String(raw).trim() === "") {
    return { ok: false, reason: "clé présente mais VALEUR VIDE" };
  }
  const cleaned = cleanChannelId(raw);
  if (!cleaned) {
    const preview = String(raw).trim().slice(0, 40);
    return {
      ok: false,
      reason: `valeur invalide (il faut l'ID numérique du salon, 17-20 chiffres). Reçu: "${preview}"`,
    };
  }
  return { ok: true, id: cleaned };
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

/** Ping des salons logs au démarrage (diagnostic détaillé). */
async function probeLogChannels(client) {
  const targets = [
    "ADMIN_LOGS_CHANNEL_ID",
    "PUBLIC_LOGS_CHANNEL_ID",
    "REVIEWS_CHANNEL_ID",
  ];

  console.log("[logs] Diagnostic .env salons:");
  for (const envKey of targets) {
    const diag = diagnoseChannelEnv(envKey);
    if (!diag.ok) {
      console.warn(`[logs] ${envKey} → ${diag.reason}`);
      continue;
    }
    try {
      const ch = await client.channels.fetch(diag.id);
      console.log(`[logs] ${envKey} OK → #${ch.name} (${diag.id})`);
    } catch (err) {
      console.error(
        `[logs] ${envKey} ID lu (${diag.id}) mais salon inaccessible: ${err.message}`
      );
      console.error(
        "[logs] → le bot doit voir le salon (permissions) et l'ID doit être celui du salon, pas du serveur"
      );
    }
  }

  // Recharge depuis process.env (au cas où config a été figé avec valeurs vides)
  const adminId = cleanChannelId(process.env.ADMIN_LOGS_CHANNEL_ID);
  if (adminId) {
    // sync config runtime
    config.adminLogsChannelId = adminId;
    config.publicLogsChannelId = cleanChannelId(process.env.PUBLIC_LOGS_CHANNEL_ID);
    config.reviewsChannelId = cleanChannelId(process.env.REVIEWS_CHANNEL_ID);

    await logAdmin(client, "Bot démarré", [
      `Bot connecté — logs admin opérationnels.`,
      `Public logs: ${config.publicLogsChannelId ? "OK" : "non configuré"}`,
      `Reviews: ${config.reviewsChannelId ? "OK" : "non configuré"}`,
    ]);
  } else {
    console.warn(
      "[logs] Aucun ADMIN_LOGS_CHANNEL_ID valide → aucun log Discord ne partira.\n" +
        "Exemple dans .env (sans espaces, sans guillemets nécessaires):\n" +
        "ADMIN_LOGS_CHANNEL_ID=123456789012345678\n" +
        "PUBLIC_LOGS_CHANNEL_ID=123456789012345678\n" +
        "REVIEWS_CHANNEL_ID=123456789012345678\n" +
        "Astuce: Mode développeur Discord → clic droit salon → Copier l'identifiant du salon"
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
