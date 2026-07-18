const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const db = require("../database");
const config = require("../config");
const { formatLtcAmount } = require("../utils/ltcPrice");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your detailed escrow deal statistics")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("View another user's stats (optional)")
      .setRequired(false)
  );

function countByStatus(rows, status) {
  return rows.filter((r) => r.status === status).length;
}

function sumLtc(rows) {
  let total = 0;
  for (const r of rows) {
    const n = Number(r.expected_pay_amount ?? r.pay_amount ?? r.received_pay_amount);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

function avgRating(rows) {
  const rated = rows.filter((r) => r.review_rating != null);
  if (rated.length === 0) return null;
  const sum = rated.reduce((a, r) => a + Number(r.review_rating), 0);
  return sum / rated.length;
}

function gatherStats(userId) {
  // buyer_id = Customer (pays), seller_id = Seller (receives)
  const asCustomer = db
    .prepare(
      `SELECT * FROM deals WHERE buyer_id = ? ORDER BY created_at DESC`
    )
    .all(userId);
  const asSeller = db
    .prepare(
      `SELECT * FROM deals WHERE seller_id = ? ORDER BY created_at DESC`
    )
    .all(userId);

  const allCodes = new Set([
    ...asCustomer.map((d) => d.deal_code),
    ...asSeller.map((d) => d.deal_code),
  ]);

  const completedCustomer = asCustomer.filter((d) => d.status === "completed");
  const completedSeller = asSeller.filter((d) => d.status === "completed");

  return {
    asCustomer,
    asSeller,
    totalUnique: allCodes.size,
    customer: {
      total: asCustomer.length,
      completed: countByStatus(asCustomer, "completed"),
      awaitingPayment: countByStatus(asCustomer, "awaiting_payment"),
      fundsHeld: countByStatus(asCustomer, "funds_held"),
      released: countByStatus(asCustomer, "released"),
      disputed: countByStatus(asCustomer, "disputed"),
      refunded: countByStatus(asCustomer, "refunded") + countByStatus(asCustomer, "refunding"),
      cancelled: countByStatus(asCustomer, "cancelled"),
      volumeLtc: sumLtc(completedCustomer),
      avgRatingGiven: avgRating(completedCustomer),
      reviewsGiven: completedCustomer.filter((d) => d.review_at).length,
    },
    seller: {
      total: asSeller.length,
      completed: countByStatus(asSeller, "completed"),
      awaitingPayment: countByStatus(asSeller, "awaiting_payment"),
      fundsHeld: countByStatus(asSeller, "funds_held"),
      released: countByStatus(asSeller, "released"),
      disputed: countByStatus(asSeller, "disputed"),
      refunded: countByStatus(asSeller, "refunded") + countByStatus(asSeller, "refunding"),
      cancelled: countByStatus(asSeller, "cancelled"),
      volumeLtc: sumLtc(completedSeller),
    },
  };
}

function roleBlock(title, emojiKey, stats) {
  const vol = formatLtcAmount(stats.volumeLtc) || "0";
  const ratingLine =
    stats.avgRatingGiven != null
      ? `\n${e("confirm")}**Avg rating given** — ${stats.avgRatingGiven.toFixed(2)}/5 (${stats.reviewsGiven} reviews)`
      : "";

  return (
    `## ${e(emojiKey)}${title}\n` +
    `**Total deals** — ${stats.total}\n` +
    `${e("success")}**Completed** — ${stats.completed}\n` +
    `${e("payment")}**Awaiting payment** — ${stats.awaitingPayment}\n` +
    `${e("shield")}**Funds held** — ${stats.fundsHeld}\n` +
    `${e("release")}**Released** — ${stats.released}\n` +
    `${e("dispute")}**Disputed** — ${stats.disputed}\n` +
    `${e("money")}**Refunded** — ${stats.refunded}\n` +
    `${e("cancel")}**Cancelled** — ${stats.cancelled}\n` +
    `${e("ltc")}**Completed volume** — \`${vol} LTC\`` +
    ratingLine
  );
}

function buildStatsContainer(user, stats) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("deal")}Deal stats — ${user.username}`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("users")}**User** — <@${user.id}>\n` +
        `${e("info")}**Unique deals** — ${stats.totalUnique}\n` +
        `${e("success")}**Completed as seller** — ${stats.seller.completed}\n` +
        `${e("success")}**Completed as customer** — ${stats.customer.completed}`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(roleBlock("As customer (pays LTC)", "buyer", stats.customer))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      roleBlock("As seller (receives LTC)", "seller", stats.seller)
    )
  );

  return container;
}

async function execute(interaction) {
  const target = interaction.options.getUser("user") || interaction.user;
  const stats = gatherStats(target.id);
  const container = buildStatsContainer(target, stats);

  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute, gatherStats };
