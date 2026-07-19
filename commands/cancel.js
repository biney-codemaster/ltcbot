const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../database");
const config = require("../config");
const { buildCloseTicketContainer } = require("../utils/dealContainer");
const { logAdmin, dealCodeTag, formatBuyerSellerLines } = require("../utils/dealLogger");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("cancel")
  .setDescription("Staff: cancel this deal immediately");

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

async function execute(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: `${e("error")}Only staff can use \`/cancel\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const deal = getDealByChannel(interaction.channelId);
  if (!deal) {
    return interaction.reply({
      content: `${e("error")}\`/cancel\` can only be used inside a **deal channel**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (deal.status === "cancelled") {
    return interaction.reply({
      content: `${e("warning")}This deal is already cancelled.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (["completed", "released", "refunded"].includes(deal.status)) {
    return interaction.reply({
      content: `${e("error")}Can't cancel a deal with status **${deal.status}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare(
    `UPDATE deals
     SET status = 'cancelled',
         cancel_initiator_confirmed = 0,
         cancel_partner_confirmed = 0,
         updated_at = datetime('now')
     WHERE deal_code = ?`
  ).run(deal.deal_code);

  const updated = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(deal.deal_code);

  await interaction.reply({
    components: [buildCloseTicketContainer(updated, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });

  await logAdmin(interaction.client, `Deal staff-cancelled #${dealCodeTag(deal.deal_code)}`, [
    `${e("cancel")}Cancelled by staff <@${interaction.user.id}>`,
    `${e("product")}**Product** — ${updated.product}`,
    `${e("money")}**Price** — ${updated.price}${updated.currency}`,
    `${e("info")}**Previous status** — ${deal.status}`,
    ...formatBuyerSellerLines(updated),
  ]);
}

module.exports = { data, execute };
