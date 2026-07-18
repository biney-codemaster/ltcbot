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
        `Les fonds sont sécurisés sur une **adresse Litecoin dédiée** jusqu'à confirmation de réception.\n\n` +
        `## ${e("info")}Déroulement\n` +
        `1. Création du deal et salon privé\n` +
        `2. Choix des rôles (acheteur / vendeur)\n` +
        `3. Confirmation mutuelle des termes\n` +
        `4. Paiement LTC puis libération vers le vendeur\n\n` +
        `${e("lock")}**Anonymat** — utilise \`/anonyme\` pour apparaître anonyme (ou non) dans les avis et logs publics.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}Nouveau deal\n` +
        `Clique ci-dessous pour ouvrir un deal sécurisé.`
    )
  );

  const startButton = new ButtonBuilder()
    .setCustomId("escrow_start_deal")
    .setLabel("Start a deal")
    .setStyle(ButtonStyle.Secondary);

  if (emojis.deal) {
    startButton.setEmoji(emojis.deal);
  }

  const row = new ActionRowBuilder().addComponents(startButton);

  // Bouton décoratif (emoji escrow uniquement) — clic silencieux
  if (emojis.escrow) {
    const decoButton = new ButtonBuilder()
      .setCustomId("escrow_deco")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(emojis.escrow);
    row.addComponents(decoButton);
  }

  container.addActionRowComponents(row);

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
