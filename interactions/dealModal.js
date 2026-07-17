const db = require("../database");
const config = require("../config");
const { createDealChannel } = require("../utils/dealChannel");
const { generateUniqueDealCode } = require("../utils/dealCode");
const { buildRoleSelectionContainer } = require("../utils/dealContainer");
const { fiatToLtc } = require("../utils/ltcPrice");
const { MessageFlags } = require("discord.js");

const { e } = config;

const CURRENCY_MAP = {
  EUR: "€",
  USD: "$",
};

async function handleDealModal(interaction) {
  const partnerId = interaction.fields.getTextInputValue("partner_id").trim();
  const product = interaction.fields.getTextInputValue("product").trim();
  const priceRaw = interaction.fields.getTextInputValue("price").trim();
  const currencyValue = interaction.fields.getStringSelectValues("currency")[0];
  const crypto = interaction.fields.getStringSelectValues("crypto")[0];

  // --- Validation ID Discord (snowflake) ---
  if (!/^\d{17,20}$/.test(partnerId)) {
    return interaction.reply({
      content: `${e("error")}ID Discord invalide. Copie l'ID exact (clic droit sur le membre → Copier l'ID).`,
      ephemeral: true,
    });
  }

  if (partnerId === interaction.user.id) {
    return interaction.reply({
      content: `${e("error")}Tu ne peux pas faire un deal avec toi-même.`,
      ephemeral: true,
    });
  }

  // --- Vérifier que le membre existe sur le serveur ---
  let partnerMember;
  try {
    partnerMember = await interaction.guild.members.fetch(partnerId);
  } catch {
    return interaction.reply({
      content: `${e("error")}Ce membre est introuvable sur ce serveur.`,
      ephemeral: true,
    });
  }

  if (partnerMember.user.bot) {
    return interaction.reply({
      content: `${e("error")}Tu ne peux pas faire un deal avec un bot.`,
      ephemeral: true,
    });
  }

  // --- Validation prix ---
  const price = Number(priceRaw.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return interaction.reply({
      content: `${e("error")}Prix invalide. Entre un nombre positif, sans symbole (ex: 25.50).`,
      ephemeral: true,
    });
  }

  // --- Validation devise (menu) ---
  const currency = CURRENCY_MAP[currencyValue];
  if (!currency) {
    return interaction.reply({
      content: `${e("error")}Devise invalide. Choisis € ou $ dans le menu.`,
      ephemeral: true,
    });
  }

  // --- Validation crypto (menu) ---
  if (crypto !== "LTC") {
    return interaction.reply({
      content: `${e("error")}Crypto non supportée pour le moment. Choisis Litecoin (LTC).`,
      ephemeral: true,
    });
  }

  // --- Conversion fiat -> crypto pour affichage (non bloquant si API down) ---
  let payAmount = null;
  try {
    const { cryptoAmount } = await fiatToLtc(price, currency);
    payAmount = cryptoAmount;
  } catch (err) {
    console.error("Conversion LTC affichage indisponible:", err.message);
  }

  // --- Génération du code de deal (6 caractères, unique) ---
  const dealCode = generateUniqueDealCode();

  // --- Insertion en base ---
  const insert = db.prepare(`
    INSERT INTO deals (
      deal_code, guild_id, channel_id, initiator_id, partner_id,
      product, price, currency, crypto, pay_amount
    )
    VALUES (
      @deal_code, @guild_id, @channel_id, @initiator_id, @partner_id,
      @product, @price, @currency, @crypto, @pay_amount
    )
  `);

  insert.run({
    deal_code: dealCode,
    guild_id: interaction.guild.id,
    channel_id: interaction.channel.id,
    initiator_id: interaction.user.id,
    partner_id: partnerId,
    product,
    price,
    currency,
    crypto,
    pay_amount: payAmount,
  });

  // --- Création du salon privé dédié à ce deal ---
  const channel = await createDealChannel(interaction.guild, dealCode, interaction.user.id, partnerId);

  db.prepare(`UPDATE deals SET channel_id = @channel_id WHERE deal_code = @deal_code`).run({
    channel_id: channel.id,
    deal_code: dealCode,
  });

  const createdDeal = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(dealCode);
  const container = buildRoleSelectionContainer(createdDeal);

  const roleMessage = await channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(`UPDATE deals SET message_id = @message_id WHERE deal_code = @deal_code`).run({
    message_id: roleMessage.id,
    deal_code: dealCode,
  });

  await interaction.reply({
    content: `${e("success")}Deal #${dealCode} créé. Rendez-vous dans ${channel} pour continuer.`,
    ephemeral: true,
  });
}

module.exports = { handleDealModal };
