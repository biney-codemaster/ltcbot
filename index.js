require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Events,
  MessageFlags,
} = require("discord.js");
const config = require("./config");
const setupCommand = require("./commands/setup");
const anonymousCommand = require("./commands/anonymous");
const statsCommand = require("./commands/stats");
const howtoCommand = require("./commands/howto");
const rulesCommand = require("./commands/rules");
const restartCommand = require("./commands/restart");
const cancelCommand = require("./commands/cancel");
const { handleEmojiListMessage } = require("./commands/emojiList");
const { handleDealModal } = require("./interactions/dealModal");
const { ensurePrefsTable } = require("./utils/userPrefs");
const {
  handleRoleButton,
  handleConfirmButton,
  handleWrongRolesButton,
  handleCancelButton,
  handleCheckPaymentButton,
  handleRegenPaymentButton,
  handleReleaseButton,
  handleSellerWalletButton,
  handleSellerWalletModal,
  handleDisputeButton,
  handleDisputeModal,
  handleStaffReleaseButton,
  handleStaffResolveButton,
  handleStaffRefundButton,
  handleStaffRefundManualButton,
  handleStaffRefundModal,
  handleCloseButton,
  handleReviewButton,
  handleReviewModal,
  handleStaffPingButton,
} = require("./interactions/dealButtons");
require("./database"); // initialise la DB au démarrage
const { startPaymentPoller } = require("./utils/paymentPoller");
const { logEnvValidation } = require("./utils/envCheck");
const { pingWallets, loadOrCreateMnemonic } = require("./utils/cryptoWallet");
const { CRYPTO_ASSETS, SUPPORTED_CRYPTOS } = require("./utils/cryptoAssets");
const { probeLogChannels } = require("./utils/dealLogger");
const { startBotPresence } = require("./utils/botPresence");
const slotCommand = require("./slot/commands/slot");
const { handleSlotInteraction } = require("./slot/handlers/interactions");
const { handleSlotMessage } = require("./slot/handlers/messageCreate");
const { startExpirationLoop } = require("./slot/services/guildActions");
const { startSlotPaymentPoller } = require("./slot/services/slotPaymentPoller");
const slotConfig = require("./slot/config");

if (!logEnvValidation()) {
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

ensurePrefsTable();
const commands = [
  setupCommand.data.toJSON(),
  anonymousCommand.data.toJSON(),
  statsCommand.data.toJSON(),
  howtoCommand.data.toJSON(),
  rulesCommand.data.toJSON(),
  restartCommand.data.toJSON(),
  cancelCommand.data.toJSON(),
  slotCommand.data.toJSON(),
];

async function registerCommands() {
  const rest = new REST().setToken(config.token);

  // Nettoyage complet des anciennes commandes (global + guild) pour éviter doublons/fantômes
  await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
  }
  console.log("Old commands cleared.");

  // Enregistrement des commandes actuelles
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  console.log("Commands registered.");
}

// ---------- Modal (reste ici pour l'instant, sera déplacé avec la logique deal) ----------
function buildDealModal() {
  const modal = new ModalBuilder()
    .setCustomId("escrow_deal_modal")
    .setTitle("New deal");

  const partnerLabel = new LabelBuilder()
    .setLabel("Other person's Discord ID")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("partner_id")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    );

  const productLabel = new LabelBuilder()
    .setLabel("Product")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("product")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    );

  const priceLabel = new LabelBuilder()
    .setLabel("Price (number only)")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("price")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g. 25.50")
    );

  const eurOption = new StringSelectMenuOptionBuilder()
    .setLabel("Euro (€)")
    .setValue("EUR")
    .setDescription("Price in euros");
  if (config.emojis.eur) eurOption.setEmoji(config.emojis.eur);

  const usdOption = new StringSelectMenuOptionBuilder()
    .setLabel("Dollar ($)")
    .setValue("USD")
    .setDescription("Price in dollars");
  if (config.emojis.usd) usdOption.setEmoji(config.emojis.usd);

  const currencyLabel = new LabelBuilder()
    .setLabel("Currency")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("currency")
        .setPlaceholder("Choose a currency")
        .setRequired(true)
        .addOptions(eurOption, usdOption)
    );

  const cryptoOptions = SUPPORTED_CRYPTOS.map((code) => {
    const asset = CRYPTO_ASSETS[code];
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(asset.label)
      .setValue(asset.code)
      .setDescription(asset.description);
    const emoji = config.emojis[asset.emojiKey] || config.emojis.crypto;
    if (emoji) option.setEmoji(emoji);
    return option;
  });

  const cryptoLabel = new LabelBuilder()
    .setLabel("Deal crypto")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("crypto")
        .setPlaceholder("Choose a crypto")
        .setRequired(true)
        .addOptions(...cryptoOptions)
    );

  modal.addLabelComponents(partnerLabel, productLabel, priceLabel, currencyLabel, cryptoLabel);

  return modal;
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  try {
    loadOrCreateMnemonic();
    const probes = await pingWallets();
    for (const [code, result] of Object.entries(probes)) {
      if (result?.ok) {
        console.log(`Wallet ${code} OK (probe ${result.probe_address}).`);
      } else {
        console.warn(`Wallet ${code} KO:`, result?.error || "unknown");
      }
    }
  } catch (err) {
    console.error("Wallet crypto KO au démarrage:", err.message);
  }

  try {
    const customerRoleId =
      typeof config.getCustomerRoleId === "function"
        ? config.getCustomerRoleId()
        : config.customerRoleId || null;
    if (!customerRoleId) {
      console.warn("[roles] CUSTOMER_ROLE_ID not set — reviews will not grant a role");
    } else if (config.guildId) {
      const guild = await client.guilds.fetch(config.guildId);
      const role = await guild.roles.fetch(customerRoleId).catch(() => null);
      const me = guild.members.me || (await guild.members.fetchMe());
      if (!role) {
        console.warn(`[roles] CUSTOMER_ROLE_ID=${customerRoleId} not found on guild`);
      } else if (role.position >= me.roles.highest.position) {
        console.warn(
          `[roles] CUSTOMER_ROLE "${role.name}" is above/equal the bot role — move the bot higher in Server Settings → Roles`
        );
      } else {
        console.log(`[roles] CUSTOMER_ROLE ready: ${role.name} (${role.id})`);
      }
    } else {
      console.log(`[roles] CUSTOMER_ROLE_ID=${customerRoleId}`);
    }
  } catch (err) {
    console.warn("[roles] Could not verify CUSTOMER_ROLE_ID:", err.message);
  }

  await probeLogChannels(client);
  startPaymentPoller(client);
  console.log("Crypto wallet polling started (5s).");
  startBotPresence(client);
  startExpirationLoop(client, slotConfig.checkIntervalMs);
  startSlotPaymentPoller(client);
  console.log(
    `[slots] caps: free ${slotConfig.maxFreeSlots} · paid ${slotConfig.maxPaidSlots} · payment poller on`
  );
  if (slotConfig.ownerId) {
    console.log(`[slots] OWNER_ID set — /slot owner commands enabled`);
  } else {
    console.warn(
      "[slots] OWNER_ID empty — /slot activate/buy work, but owner subcommands (create/config/panels) are locked"
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
      await setupCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "anonymous") {
      await anonymousCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "stats") {
      await statsCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "howto") {
      await howtoCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "rules") {
      await rulesCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "restart") {
      await restartCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "cancel") {
      await cancelCommand.execute(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "slot") {
      await slotCommand.execute(interaction);
      return;
    }

    if (await handleSlotInteraction(interaction)) {
      return;
    }

    if (interaction.isButton() && interaction.customId === "escrow_start_deal") {
      await interaction.showModal(buildDealModal());
    }

    // Bouton décoratif du panel — accuse réception sans message / erreur
    if (interaction.isButton() && interaction.customId === "escrow_deco") {
      await interaction.deferUpdate();
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_role:")) {
      const [, role, dealCode] = interaction.customId.split(":");
      await handleRoleButton(interaction, role, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_confirm:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleConfirmButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_wrong_roles:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleWrongRolesButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_cancel:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleCancelButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_check_payment:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleCheckPaymentButton(interaction, dealCode);
    }


    if (interaction.isButton() && interaction.customId.startsWith("deal_regen_payment:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleRegenPaymentButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_release:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleReleaseButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_seller_wallet:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleSellerWalletButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_dispute:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleDisputeButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_ping:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffPingButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_release:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffReleaseButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_resolve:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffResolveButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_refund:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffRefundButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_refund_manual:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffRefundManualButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_close:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleCloseButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_review:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleReviewButton(interaction, dealCode);
    }

    if (interaction.isModalSubmit() && interaction.customId === "escrow_deal_modal") {
      await handleDealModal(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("deal_seller_wallet_modal:")) {
      await handleSellerWalletModal(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("deal_dispute_modal:")) {
      await handleDisputeModal(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("deal_review_modal:")) {
      await handleReviewModal(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("deal_staff_refund_modal:")) {
      await handleStaffRefundModal(interaction);
    }
  } catch (err) {
    console.error("Erreur interaction:", err);
    const payload = {
      content: "Something went wrong. Try again or contact staff.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  try {
    await handleSlotMessage(message);
  } catch (err) {
    console.error("Erreur slot ping:", err);
  }
  try {
    await handleEmojiListMessage(message);
  } catch (err) {
    console.error("Erreur +emoji:", err);
    await message.reply(`${config.e("error")}Could not list emojis.`).catch(() => {});
  }
});

registerCommands().catch((err) => console.error("Erreur registerCommands:", err));
client.login(config.token);
