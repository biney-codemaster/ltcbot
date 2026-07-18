const config = require("../config");

/**
 * Silently assign CUSTOMER_ROLE_ID to a member after they complete a deal review.
 * No user-facing message on success or failure.
 */
async function assignCustomerRole(client, guildId, userId) {
  const roleId = config.customerRoleId;
  if (!roleId || !guildId || !userId || !client) return false;

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return false;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    if (member.roles.cache.has(roleId)) return true;

    await member.roles.add(roleId, "Completed escrow deal review");
    console.log(`[roles] CUSTOMER_ROLE assigned to ${userId} in ${guildId}`);
    return true;
  } catch (err) {
    console.warn(`[roles] Could not assign CUSTOMER_ROLE to ${userId}:`, err.message);
    return false;
  }
}

module.exports = { assignCustomerRole };
