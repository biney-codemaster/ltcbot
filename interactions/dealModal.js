const db = require("../database");
const config = require("../config");
const { createDealChannel } = require("../utils/dealChannel");
const { generateUniqueDealCode } = require("../utils/dealCode");
const { buildRoleSelectionContainer } = require("../utils/dealContainer");
const { fiatToCrypto, isSupportedCrypto, SUPPORTED_CRYPTOS } = require("../utils/cryptoWallet");
const { MessageFlags } = require("discord.js");
const { logAdmin, dealCodeTag } = require("../utils/dealLogger");
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
      content: `${e("error")}Invalid Discord ID. Copy the exact ID (right-click member → Copy ID).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (partnerId === interaction.user.id) {
    return interaction.reply({
      content: `${e("error")}You can't open a deal with yourself.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- Vérifier que le membre existe sur le serveur ---
  let partnerMember;
  try {
    partnerMember = await interaction.guild.members.fetch(partnerId);
  } catch {
    return interaction.reply({
      content: `${e("error")}That member was not found on this server.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (partnerMember.user.bot) {
    return interaction.reply({
      content: `${e("error")}You can't open a deal with a bot.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- Validation prix ---
  const price = Number(priceRaw.replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    return interaction.reply({
      content: `${e("error")}Invalid price. Enter a positive number with no symbol (e.g. 25.50).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- Validation devise (menu) ---
  const currency = CURRENCY_MAP[currencyValue];
  if (!currency) {
    return interaction.reply({
      content: `${e("error")}Invalid currency. Pick € or $ from the menu.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- Validation crypto (menu) ---
  if (!isSupportedCrypto(crypto)) {
    return interaction.reply({
      content: `${e("error")}Unsupported crypto. Choose one of: ${SUPPORTED_CRYPTOS.join(", ")}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- Conversion fiat -> crypto pour affichage (non bloquant si API down) ---
  let payAmount = null;
  try {
    const { cryptoAmount } = await fiatToCrypto(price, currency, crypto);
    payAmount = cryptoAmount;
  } catch (err) {
    console.error(`Conversion ${crypto} affichage indisponible:`, err.message);
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

  // Ping participants (message séparé — Components V2 n'accepte pas content + container)
  await channel.send({
    content: `${e("users")}<@${interaction.user.id}> <@${partnerId}> — deal #${dealCodeTag(dealCode)} started. Choose your roles below.`,
    allowedMentions: { users: [interaction.user.id, partnerId] },
  });

  const roleMessage = await channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });

  db.prepare(`UPDATE deals SET message_id = @message_id WHERE deal_code = @deal_code`).run({
    message_id: roleMessage.id,
    deal_code: dealCode,
  });

  await interaction.reply({
    content: `${e("success")}Deal #${dealCodeTag(dealCode)} created. Continue in ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });

  await logAdmin(interaction.client, `Deal created #${dealCodeTag(dealCode)}`, [
    `${e("deal")}Channel ${channel}`,
    `${e("product")}**Product** — ${product}`,
    `${e("money")}**Price** — ${price}${currency}`,
    `${e("users")}Participants — <@${interaction.user.id}> ↔ <@${partnerId}>`,
    `${e("buyer")}**Customer** — *to be set*`,
    `${e("seller")}**Seller** — *to be set*`,
  ]);
}

module.exports = { handleDealModal };
