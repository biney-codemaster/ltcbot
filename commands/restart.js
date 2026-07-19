const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../database");
const config = require("../config");
const {
  buildRoleSelectionContainer,
} = require("../utils/dealContainer");
const { logAdmin, dealCodeTag, formatBuyerSellerLines } = require("../utils/dealLogger");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("restart")
  .setDescription("Staff: wipe this deal channel and restart the deal from role selection");

function getStaffRoleId() {
  const raw = String(config.staffRoleId || process.env.STAFF_ROLE_ID || "").trim();
  const m = raw.match(/(\d{16,22})/);
  return m ? m[1] : null;
}

function isStaff(member) {
  const roleId = getStaffRoleId();
  return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

function getDealByChannel(channelId) {
  return db
    .prepare("SELECT * FROM deals WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(channelId);
}

const BLOCKED = new Set([
  "funds_held",
  "released",
  "awaiting_review",
  "disputed",
  "refunding",
  "refunded",
  "completed",
]);

async function purgeChannelMessages(channel) {
  let deleted = 0;
  for (let i = 0; i < 25; i++) {
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const young = batch.filter(
      (m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
    );
    if (young.size > 0) {
      await channel.bulkDelete(young, true).catch(() => null);
      deleted += young.size;
    }

    const old = batch.filter(
      (m) => Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
    );
    for (const msg of old.values()) {
      await msg.delete().catch(() => null);
      deleted += 1;
    }

    if (batch.size < 100) break;
  }
  return deleted;
}

async function execute(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: `${e("error")}Only staff can use \`/restart\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const deal = getDealByChannel(interaction.channelId);
  if (!deal) {
    return interaction.reply({
      content: `${e("error")}\`/restart\` can only be used inside a **deal channel**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (BLOCKED.has(deal.status)) {
    return interaction.reply({
      content: `${e("error")}Can't restart while status is **${deal.status}** (funds may be at risk).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  db.prepare(
    `UPDATE deals
     SET buyer_id = NULL,
         seller_id = NULL,
         initiator_confirmed = 0,
         partner_confirmed = 0,
         confirm_message_id = NULL,
         message_id = NULL,
         payment_id = NULL,
         pay_address = NULL,
         expected_pay_amount = NULL,
         received_pay_amount = NULL,
         payment_status = NULL,
         payment_message_id = NULL,
         seller_wallet = NULL,
         buyer_wallet = NULL,
         payout_id = NULL,
         payout_status = NULL,
         payout_error = NULL,
         funds_held_message_id = NULL,
         dispute_reason = NULL,
         mediator_id = NULL,
         cancel_initiator_confirmed = 0,
         cancel_partner_confirmed = 0,
         review_text = NULL,
         review_rating = NULL,
         review_anonymous = 0,
         review_at = NULL,
         review_prompted = 0,
         completed_at = NULL,
         status = 'pending_confirmation',
         updated_at = datetime('now')
     WHERE deal_code = ?`
  ).run(deal.deal_code);

  await purgeChannelMessages(interaction.channel);

  db.prepare(`DELETE FROM deal_staff_pings WHERE deal_code = ?`).run(deal.deal_code);

  const restarted = db
    .prepare("SELECT * FROM deals WHERE deal_code = ?")
    .get(deal.deal_code);

  await interaction.channel.send({
    content: `${e("users")}<@${restarted.initiator_id}> <@${restarted.partner_id}> — deal #${dealCodeTag(deal.deal_code)} restarted. Choose your roles below.`,
    allowedMentions: { users: [restarted.initiator_id, restarted.partner_id] },
  });

  const roleMessage = await interaction.channel.send({
    components: [buildRoleSelectionContainer(restarted)],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(`UPDATE deals SET message_id = ? WHERE deal_code = ?`).run(
    roleMessage.id,
    deal.deal_code
  );

  await logAdmin(interaction.client, `Deal restarted #${dealCodeTag(deal.deal_code)}`, [
    `${e("next")}Restarted by <@${interaction.user.id}>`,
    `${e("product")}**Product** — ${restarted.product}`,
    ...formatBuyerSellerLines(restarted),
  ]);

  await interaction.editReply({
    content: `${e("success")}Deal #${dealCodeTag(deal.deal_code)} restarted from role selection.`,
  });
}

module.exports = { data, execute };
