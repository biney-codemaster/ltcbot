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
const { handleDealModal } = require("./interactions/dealModal");
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
  handleCloseButton,
} = require("./interactions/dealButtons");
require("./database"); // initialise la DB au démarrage
const { startPaymentPoller } = require("./utils/paymentPoller");
const { logEnvValidation } = require("./utils/envCheck");

if (!logEnvValidation()) {
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [setupCommand.data.toJSON()];

async function registerCommands() {
  const rest = new REST().setToken(config.token);

  // Nettoyage complet des anciennes commandes (global + guild) pour éviter doublons/fantômes
  await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
  }
  console.log("Anciennes commandes supprimées.");

  // Enregistrement des commandes actuelles
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  console.log("Commandes enregistrées.");
}

// ---------- Modal (reste ici pour l'instant, sera déplacé avec la logique deal) ----------
function buildDealModal() {
  const modal = new ModalBuilder()
    .setCustomId("escrow_deal_modal")
    .setTitle("Nouveau deal");

  const partnerLabel = new LabelBuilder()
    .setLabel("ID Discord de l'autre personne")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("partner_id")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    );

  const productLabel = new LabelBuilder()
    .setLabel("Produit")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("product")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    );

  const priceLabel = new LabelBuilder()
    .setLabel("Prix (nombre uniquement)")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("price")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("ex: 25.50")
    );

  const currencyLabel = new LabelBuilder()
    .setLabel("Devise")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("currency")
        .setPlaceholder("Choisir une devise")
        .setRequired(true)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Euro (€)")
            .setValue("EUR")
            .setDescription("Prix en euros"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Dollar ($)")
            .setValue("USD")
            .setDescription("Prix en dollars")
        )
    );

  const cryptoLabel = new LabelBuilder()
    .setLabel("Crypto du deal")
    .setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId("crypto")
        .setPlaceholder("Choisir une crypto")
        .setRequired(true)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Litecoin (LTC)")
            .setValue("LTC")
            .setDescription("Paiement en Litecoin")
        )
    );

  modal.addLabelComponents(partnerLabel, productLabel, priceLabel, currencyLabel, cryptoLabel);

  return modal;
}

client.once(Events.ClientReady, () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  startPaymentPoller(client);
  console.log("Polling OxaPay démarré (30s).");
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
      await setupCommand.execute(interaction);
    }

    if (interaction.isButton() && interaction.customId === "escrow_start_deal") {
      await interaction.showModal(buildDealModal());
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

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_release:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffReleaseButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_staff_resolve:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleStaffResolveButton(interaction, dealCode);
    }

    if (interaction.isButton() && interaction.customId.startsWith("deal_close:")) {
      const [, dealCode] = interaction.customId.split(":");
      await handleCloseButton(interaction, dealCode);
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
  } catch (err) {
    console.error("Erreur interaction:", err);
    const payload = {
      content: "Une erreur est survenue. Réessaie ou contacte le staff.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

registerCommands().catch((err) => console.error("Erreur registerCommands:", err));
client.login(config.token);
