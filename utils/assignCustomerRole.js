const { PermissionFlagsBits } = require("discord.js");
const config = require("../config");

/**
 * Silently assign CUSTOMER_ROLE_ID after a completed deal review.
 * Prefers interaction guild/member when provided (more reliable than re-fetch).
 */
async function assignCustomerRole(client, guildId, userId, opts = {}) {
  const roleId = config.getCustomerRoleId();
  if (!roleId) {
    console.warn(
      "[roles] CUSTOMER_ROLE_ID missing/empty — skip role assignment after review"
    );
    return { ok: false, reason: "CUSTOMER_ROLE_ID not set" };
  }
  if (!guildId || !userId || !client) {
    return { ok: false, reason: "missing guild/user/client" };
  }

  try {
    const guild =
      opts.guild && opts.guild.id === guildId
        ? opts.guild
        : await client.guilds.fetch(guildId);

    if (!guild) return { ok: false, reason: "guild not found" };

    let member =
      opts.member && opts.member.id === userId ? opts.member : null;
    if (!member) {
      member = await guild.members.fetch(userId).catch(() => null);
    }
    if (!member) {
      console.warn(`[roles] Member ${userId} not found in ${guildId}`);
      return { ok: false, reason: "member not in guild" };
    }

    if (member.roles.cache.has(roleId)) {
      console.log(`[roles] ${userId} already has CUSTOMER_ROLE`);
      return { ok: true, reason: "already has role" };
    }

    const me = guild.members.me || (await guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn(
        "[roles] Bot lacks Manage Roles — cannot assign CUSTOMER_ROLE"
      );
      return { ok: false, reason: "bot missing Manage Roles" };
    }

    const role =
      guild.roles.cache.get(roleId) ||
      (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      console.warn(`[roles] CUSTOMER_ROLE_ID ${roleId} not found on this guild`);
      return { ok: false, reason: `role ${roleId} not found` };
    }
    if (role.managed) {
      console.warn(`[roles] Role ${role.name} is managed — cannot assign`);
      return { ok: false, reason: "role is managed" };
    }
    if (role.position >= me.roles.highest.position) {
      console.warn(
        `[roles] CUSTOMER_ROLE "${role.name}" is above/equal bot's top role — move the bot role higher`
      );
      return { ok: false, reason: "role above bot in hierarchy" };
    }

    await member.roles.add(role, "Completed escrow deal review");
    console.log(
      `[roles] CUSTOMER_ROLE "${role.name}" assigned to ${userId} in ${guildId}`
    );
    return { ok: true, reason: "assigned" };
  } catch (err) {
    console.warn(
      `[roles] Could not assign CUSTOMER_ROLE to ${userId}:`,
      err.message
    );
    return { ok: false, reason: err.message };
  }
}

module.exports = { assignCustomerRole };
