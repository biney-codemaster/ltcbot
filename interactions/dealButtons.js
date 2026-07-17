const { MessageFlags } = require("discord.js");
const db = require("../database");
const config = require("../config");
const {
  buildRoleSelectionContainer,
  buildConfirmationContainer,
  buildFinalRecapContainer,
  buildCloseTicketContainer,
} = require("../utils/dealContainer");

function getDealByCode(dealCode) {
  return db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(dealCode);
}

function isParticipant(deal, userId) {
  return userId === deal.initiator_id || userId === deal.partner_id;
}

function isStaff(member) {
  return config.staffRoleId && member.roles.cache.has(config.staffRoleId);
}

/**
 * Clic sur "Acheteur" ou "Vendeur".
 */
async function handleRoleButton(interaction, role, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) {
    return interaction.reply({ content: `${config.emojiText.info} Deal introuvable.`, ephemeral: true });
  }
  if (!isParticipant(deal, interaction.user.id)) {
    return interaction.reply({ content: `${config.emojiText.info} Ce deal ne te concerne pas.`, ephemeral: true });
  }

  const userId = interaction.user.id;
  const updates = {};

  if (role === "BUYER") {
    if (deal.seller_id === userId) updates.seller_id = null;
    updates.buyer_id = userId;
  } else {
    if (deal.buyer_id === userId) updates.buyer_id = null;
    updates.seller_id = userId;
  }

  const setClause = Object.keys(updates).map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE deals SET ${setClause} WHERE deal_code = @deal_code`).run({
    ...updates,
    deal_code: dealCode,
  });

  const updatedDeal = getDealByCode(dealCode);
  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });

  if (updatedDeal.buyer_id && updatedDeal.seller_id && !updatedDeal.confirm_message_id) {
    const confirmMessage = await interaction.channel.send({
      components: [buildConfirmationContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });
    db.prepare(`UPDATE deals SET confirm_message_id = @id WHERE deal_code = @deal_code`).run({
      id: confirmMessage.id,
      deal_code: dealCode,
    });
  }
}

/**
 * Clic sur "Confirmer".
 */
async function handleConfirmButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) {
    return interaction.reply({ content: `${config.emojiText.info} Deal introuvable.`, ephemeral: true });
  }
  if (!isParticipant(deal, interaction.user.id)) {
    return interaction.reply({ content: `${config.emojiText.info} Ce deal ne te concerne pas.`, ephemeral: true });
  }

  const isInitiator = interaction.user.id === deal.initiator_id;
  const field = isInitiator ? "initiator_confirmed" : "partner_confirmed";

  if (deal[field]) {
    return interaction.reply({ content: `${config.emojiText.info} Tu as déjà confirmé.`, ephemeral: true });
  }

  db.prepare(`UPDATE deals SET ${field} = 1 WHERE deal_code = ?`).run(dealCode);
  let updatedDeal = getDealByCode(dealCode);

  if (updatedDeal.initiator_confirmed && updatedDeal.partner_confirmed) {
    db.prepare(`UPDATE deals SET status = 'awaiting_payment' WHERE deal_code = ?`).run(dealCode);
    updatedDeal = getDealByCode(dealCode);

    await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });

    // Étape 3: récap final envoyé en nouveau message
    await interaction.channel.send({
      components: [buildFinalRecapContainer(updatedDeal)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  await interaction.update({ components: [buildConfirmationContainer(updatedDeal)] });
}

/**
 * Clic sur "Rôles incorrects": réinitialise et renvoie un NOUVEAU container de sélection.
 */
async function handleWrongRolesButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) {
    return interaction.reply({ content: `${config.emojiText.info} Deal introuvable.`, ephemeral: true });
  }
  if (!isParticipant(deal, interaction.user.id)) {
    return interaction.reply({ content: `${config.emojiText.info} Ce deal ne te concerne pas.`, ephemeral: true });
  }

  db.prepare(`
    UPDATE deals
    SET buyer_id = NULL, seller_id = NULL, initiator_confirmed = 0, partner_confirmed = 0, confirm_message_id = NULL
    WHERE deal_code = ?
  `).run(dealCode);

  const updatedDeal = getDealByCode(dealCode);

  // Ferme le message de confirmation actuel (plus de boutons)
  await interaction.update({ components: [] });

  // Envoie un NOUVEAU container de sélection des rôles
  const newRoleMessage = await interaction.channel.send({
    components: [buildRoleSelectionContainer(updatedDeal)],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(`UPDATE deals SET message_id = @message_id WHERE deal_code = @deal_code`).run({
    message_id: newRoleMessage.id,
    deal_code: dealCode,
  });
}

/**
 * Clic sur "Annuler" (container étape 1): marque le deal annulé, envoie le container de fermeture.
 */
async function handleCancelButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) {
    return interaction.reply({ content: `${config.emojiText.info} Deal introuvable.`, ephemeral: true });
  }
  if (!isParticipant(deal, interaction.user.id)) {
    return interaction.reply({ content: `${config.emojiText.info} Ce deal ne te concerne pas.`, ephemeral: true });
  }

  db.prepare(`UPDATE deals SET status = 'cancelled' WHERE deal_code = ?`).run(dealCode);
  const updatedDeal = getDealByCode(dealCode);

  // Ferme le container de sélection des rôles (plus de boutons actifs)
  await interaction.update({ components: [buildRoleSelectionContainer(updatedDeal)] });

  await interaction.channel.send({
    components: [buildCloseTicketContainer(updatedDeal, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/**
 * Clic sur "Fermer le salon": réservé au staff.
 */
async function handleCloseButton(interaction, dealCode) {
  const deal = getDealByCode(dealCode);
  if (!deal) {
    return interaction.reply({ content: `${config.emojiText.info} Deal introuvable.`, ephemeral: true });
  }

  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: `${config.emojiText.info} Seul le staff peut fermer ce salon.`,
      ephemeral: true,
    });
  }

  await interaction.reply({ content: `${config.emojiText.info} Salon fermé par <@${interaction.user.id}>. Suppression dans 5 secondes...` });
  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 5000);
}

module.exports = {
  handleRoleButton,
  handleConfirmButton,
  handleWrongRolesButton,
  handleCancelButton,
  handleCloseButton,
  getDealByCode,
};
