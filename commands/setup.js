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
  ChannelType,
} = require("discord.js");
const config = require("../config");

const { e, emojis } = config;

const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Post the deal panel in this channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((opt) =>
    opt
      .setName("howto_channel")
      .setDescription("How-to-use channel (optional if HOWTO_CHANNEL_ID is set in .env)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)
  );

function resolveHowtoChannelId(interaction) {
  const picked = interaction.options.getChannel("howto_channel");
  if (picked?.id) return picked.id;
  return config.getHowtoChannelId();
}

function buildSetupContainer(guildId, howtoChannelId) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("escrow")}Escrow`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const howtoLine = howtoChannelId
    ? `\n${e("info")}Guide — <#${howtoChannelId}>`
    : "";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("deal")}Start a secured Litecoin deal.${howtoLine}`
    )
  );

  const rowButtons = [];

  if (emojis.escrow) {
    rowButtons.push(
      new ButtonBuilder()
        .setCustomId("escrow_deco")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.escrow)
    );
  }

  rowButtons.push(
    new ButtonBuilder()
      .setCustomId("escrow_start_deal")
      .setLabel("Start a deal")
      .setStyle(ButtonStyle.Secondary)
  );

  // Bouton secondary (toujours affiché) — ouvre un lien vers le salon au clic
  if (howtoChannelId) {
    rowButtons.push(
      new ButtonBuilder()
        .setCustomId(`escrow_howto:${howtoChannelId}`)
        .setLabel("How to use")
        .setStyle(ButtonStyle.Secondary)
    );
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
  const howtoChannelId = resolveHowtoChannelId(interaction);
  const rawEnv = String(process.env.HOWTO_CHANNEL_ID || "").trim();

  if (!howtoChannelId) {
    await interaction.reply({
      content:
        `${e("success")}Panel sent **without** How to use button.\n` +
        `${e("warning")}Set \`HOWTO_CHANNEL_ID=...\` in \`.env\` and **restart the bot**,\n` +
        `or run \`/setup howto_channel:#your-channel\`.\n` +
        (rawEnv
          ? `${e("error")}Raw value was \`${rawEnv}\` — could not parse a channel ID.`
          : `${e("info")}Process env \`HOWTO_CHANNEL_ID\` is empty (bot may not see your .env).`),
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: `${e("success")}Panel sent — How to use → <#${howtoChannelId}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.channel.send({
    components: [buildSetupContainer(guildId, howtoChannelId)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/** Bouton How to use → lien cliquable vers le salon (éphémère). */
async function handleHowtoButton(interaction) {
  const channelId = interaction.customId.split(":")[1];
  const guildId = interaction.guildId;
  if (!channelId || !/^\d{16,22}$/.test(channelId)) {
    return interaction.reply({
      content: `${e("error")}How to use channel is not configured.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!guildId) {
    return interaction.reply({
      content: `${e("info")}How to use → <#${channelId}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const url = `https://discord.com/channels/${guildId}/${channelId}`;
  await interaction.reply({
    content: `${e("info")}How to use → <#${channelId}>`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Open channel")
          .setStyle(ButtonStyle.Link)
          .setURL(url)
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute, buildSetupContainer, handleHowtoButton };
