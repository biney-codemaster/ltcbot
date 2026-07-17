const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require("discord.js");
const config = require("../config");

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Affiche le panneau pour démarrer un deal en escrow");

function buildSetupContainer() {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${config.emojiText.info} **Système d'escrow**\n` +
        `Ce bot sert d'intermédiaire de confiance entre acheteur et vendeur.\n` +
        `L'argent est retenu jusqu'à confirmation de réception du produit.`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${config.emojiText.deal} Clique ci-dessous pour démarrer un nouveau deal.`
    )
  );

  const button = new ButtonBuilder()
    .setCustomId("escrow_start_deal")
    .setLabel("Start a deal")
    .setStyle(ButtonStyle.Secondary);

  // On ne met l'emoji que s'il est correctement configuré (évite le crash)
  if (config.emojis.deal) {
    button.setEmoji(config.emojis.deal);
  }

  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));

  return container;
}

async function execute(interaction) {
  const container = buildSetupContainer();
  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute };
