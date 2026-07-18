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
  .setDescription("Post the deal panel in this channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function applyEmoji(button, key) {
  if (emojis[key]) button.setEmoji(emojis[key]);
  return button;
}

function buildSetupContainer(guildId) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("escrow")}Escrow`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("deal")}Start a secured Litecoin deal.`
    )
  );

  const startButton = new ButtonBuilder()
    .setCustomId("escrow_start_deal")
    .setLabel("Start a deal")
    .setStyle(ButtonStyle.Secondary);

  const rowButtons = [];

  if (emojis.escrow) {
    rowButtons.push(
      new ButtonBuilder()
        .setCustomId("escrow_deco")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.escrow)
    );
  }

  rowButtons.push(startButton);

  if (config.howtoChannelId && guildId) {
    const howtoButton = applyEmoji(
      new ButtonBuilder()
        .setLabel("How to use")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://discord.com/channels/${guildId}/${config.howtoChannelId}`
        ),
      "info"
    );
    rowButtons.push(howtoButton);
  }

  container.addActionRowComponents(new ActionRowBuilder().addComponents(...rowButtons));

  return container;
}

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: `${e("error")}Permission denied. You need **Manage Server**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  if (!config.howtoChannelId) {
    await interaction.reply({
      content:
        `${e("success")}Panel sent.\n` +
        `${e("warning")}Set \`HOWTO_CHANNEL_ID\` in \`.env\` to show the **How to use** link button.`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: `${e("success")}Panel sent.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const container = buildSetupContainer(guildId);
  await interaction.channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute };
