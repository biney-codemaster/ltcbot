const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const config = require("../config");

const { e, emojis } = config;

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Affiche le panneau pour démarrer un deal en escrow")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function buildSetupContainer() {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("escrow")}Système d'escrow`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("shield")}Intermédiaire de confiance entre **acheteur** et **vendeur**.\n` +
        `Les fonds sont sécurisés en Custody jusqu'à confirmation de réception.\n\n` +
        `## ${e("info")}Déroulement\n` +
        `1. Création du deal et salon privé\n` +
        `2. Choix des rôles (acheteur / vendeur)\n` +
        `3. Confirmation mutuelle des termes\n` +
        `4. Paiement LTC puis libération vers le vendeur`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}Nouveau deal\n` +
        `Cliquez ci-dessous pour ouvrir un deal sécurisé.`
    )
  );

  const button = new ButtonBuilder()
    .setCustomId("escrow_start_deal")
    .setLabel("Start a deal")
    .setStyle(ButtonStyle.Secondary);

  if (emojis.deal) {
    button.setEmoji(emojis.deal);
  }

  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return container;
}

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: `${e("error")}Permission refusée. Il faut **Gérer le serveur**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const container = buildSetupContainer();
  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute };
