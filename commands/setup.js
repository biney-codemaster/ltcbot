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

function buildSetupContainer() {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("escrow")}Escrow system`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("shield")}Trusted middleman between **seller** and **customer**.\n` +
        `Funds are secured on a **dedicated Litecoin address** until delivery is confirmed.\n\n` +
        `${e("money")}**0 service fees** — only Litecoin **network fees** apply.\n\n` +
        `## ${e("info")}How it works\n` +
        `1. Create a deal and private channel\n` +
        `2. Choose roles (seller / customer)\n` +
        `3. Mutual confirmation of terms\n` +
        `4. LTC payment then release to the customer\n\n` +
        `${e("lock")}**Anonymity** — use \`/anonymous\` to appear anonymous (or not) in reviews and public logs.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}New deal\n` +
        `Click below to open a secured deal.`
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

  await interaction.reply({
    content: `${e("success")}Panel sent.`,
    flags: MessageFlags.Ephemeral,
  });

  const container = buildSetupContainer();
  await interaction.channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute };
