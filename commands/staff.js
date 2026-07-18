const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../database");
const config = require("../config");
const { dealCodeTag } = require("../utils/dealLogger");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("staff")
  .setDescription("Ping staff for help — only works inside a deal channel");

function getDealByChannel(channelId) {
  return db
    .prepare("SELECT * FROM deals WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(channelId);
}

function getStaffRoleId() {
  const raw = String(config.staffRoleId || process.env.STAFF_ROLE_ID || "").trim();
  if (!raw) return null;
  const m = raw.match(/(\d{16,22})/);
  return m ? m[1] : null;
}

async function execute(interaction) {
  const deal = getDealByChannel(interaction.channelId);
  if (!deal) {
    return interaction.reply({
      content: `${e("error")}\`/staff\` can only be used inside a **deal channel**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const staffRoleId = getStaffRoleId();
  if (!staffRoleId) {
    return interaction.reply({
      content: `${e("error")}Staff role is not configured (\`STAFF_ROLE_ID\`).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content:
      `${e("staff")}<@&${staffRoleId}> — <@${interaction.user.id}> needs help with deal #${dealCodeTag(deal.deal_code)}.`,
    allowedMentions: { parse: [], roles: [staffRoleId], users: [interaction.user.id] },
  });
}

module.exports = { data, execute };
