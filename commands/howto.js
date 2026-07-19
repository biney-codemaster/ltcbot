const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const config = require("../config");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("howto")
  .setDescription("Post a how-to-use panel for the escrow bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function buildHowtoContainer() {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("info")}How to use escrow`)
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("shield")}Secure Litecoin deals between a **customer** and a **seller**.\n` +
        `Funds sit on a dedicated address until delivery is confirmed.\n\n` +
        `${e("money")}**0 service fees** — only Litecoin network fees apply.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("roles")}Roles\n` +
        `${e("buyer")}**Customer** — pays the LTC amount into escrow.\n` +
        `${e("seller")}**Seller** — delivers the product / receives the payout.\n\n` +
        `Pick your role carefully in the deal channel, then both sides confirm.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("deal")}Deal flow\n` +
        `1. Click **Start a deal** on the deal panel\n` +
        `2. Enter partner ID, product, price, currency & crypto\n` +
        `3. Choose roles → confirm terms\n` +
        `4. Customer sends **exactly** the LTC amount shown\n` +
        `5. Seller delivers → customer releases funds\n` +
        `6. Customer leaves a review → channel closes\n\n` +
        `${e("warning")}If the LTC amount is not exact, **no refund** is issued.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("info")}Commands\n` +
        `\`/setup\` — post the deal start panel *(staff)*\n` +
        `\`/howto\` — post this guide *(staff)*\n` +
        `\`/restart\` — wipe & restart a deal *(staff, deal channel)*\n` +
        `\`/cancel\` — cancel a deal immediately *(staff, deal channel)*\n` +
        `\`/anonymous\` — hide or show your profile in reviews & public logs\n` +
        `\`/stats\` — view your detailed deal statistics\n` +
        `\`/stats user:@someone\` — view another user's stats`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("lock")}Tips\n` +
        `• Use \`/anonymous\` before the review if you want to stay private\n` +
        `• Only the **seller** can set the withdrawal address\n` +
        `• Need help in a deal? Click the **Staff** button (max **2** pings per user)\n` +
        `• Keep your transcript HTML as proof after the deal closes`
    )
  );

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
    content: `${e("success")}How-to panel sent.`,
    flags: MessageFlags.Ephemeral,
  });

  await interaction.channel.send({
    components: [buildHowtoContainer()],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = { data, execute, buildHowtoContainer };
