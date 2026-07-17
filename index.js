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
} = require("discord.js");
const config = require("./config");
const setupCommand = require("./commands/setup");
const { handleDealModal } = require("./interactions/dealModal");
const {
  handleRoleButton,
  handleConfirmButton,
  handleWrongRolesButton,
  handleCancelButton,
  handleCloseButton,
} = require("./interactions/dealButtons");
require("./database"); // initialise la DB au démarrage

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

client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
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

  if (interaction.isButton() && interaction.customId.startsWith("deal_close:")) {
    const [, dealCode] = interaction.customId.split(":");
    await handleCloseButton(interaction, dealCode);
  }

  if (interaction.isModalSubmit() && interaction.customId === "escrow_deal_modal") {
    await handleDealModal(interaction);
  }
});

registerCommands();
client.login(config.token);
