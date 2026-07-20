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

const MAX_DISPLAY_TEXT = 4000;

const data = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Post the Nestoo server rules panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function howtoFooterLine(howtoChannelId) {
  const channelRef = howtoChannelId ? `<#${howtoChannelId}>` : "[howtouse]";
  return (
    `Need help? Read the ${channelRef} channel, then use the Staff button in your deal if something goes wrong.\n\n` +
    `Thank you for helping keep Nestoo safe and professional.`
  );
}

function rulesTextBlocks(howtoChannelId) {
  return [
    `Welcome to Nestoo. This server provides a Litecoin (LTC) escrow service to help buyers and sellers complete deals safely. By joining and using this server, you agree to follow these rules at all times.\n\n` +
      `────────────────────────────────────────\n` +
      `1. GENERAL CONDUCT\n` +
      `────────────────────────────────────────\n` +
      `• Treat all members and staff with respect. Harassment, hate speech, threats, discrimination, or targeted abuse will not be tolerated.\n` +
      `• Do not spam, flood channels, advertise without permission, or disrupt the server.\n` +
      `• Do not share illegal content, malware, phishing links, or anything that violates Discord's Terms of Service or Community Guidelines.\n` +
      `• English is the primary language for support and deal communication unless staff say otherwise.\n\n` +
      `────────────────────────────────────────\n` +
      `2. ESCROW & DEAL RULES\n` +
      `────────────────────────────────────────\n` +
      `• Use the official deal flow only. Start deals through the designated panel and follow the bot instructions.\n` +
      `• Choose your role carefully. Customer pays into escrow. Seller delivers and receives the payout. Both sides must confirm roles before payment.\n` +
      `• Send the exact LTC amount shown. Underpayments or overpayments may not be refunded automatically. Always double-check the address and amount.\n` +
      `• Do not send funds outside the escrow address provided in your deal channel unless staff instruct you to.\n` +
      `• Do not bypass escrow, rush a release, or pressure the other party before delivery is complete.\n` +
      `• Cancellation is only available before a payment address is generated, through the official process in the deal channel.\n` +
      `• Staff decisions are final in disputes, refunds, releases, or deal cancellations when mediation is required.`,

    `────────────────────────────────────────\n` +
      `3. PAYMENTS & FEES\n` +
      `────────────────────────────────────────\n` +
      `• Nestoo charges 0 service fees. Only Litecoin network fees apply.\n` +
      `• The Customer is responsible for sending the correct amount to the correct address.\n` +
      `• Once funds are confirmed on-chain and held in escrow, the deal follows the agreed terms and bot workflow.\n` +
      `• Nestoo is not responsible for user error (wrong address, wrong amount, wrong network, or third-party wallet issues).\n\n` +
      `────────────────────────────────────────\n` +
      `4. DELIVERY, RELEASE & REVIEWS\n` +
      `────────────────────────────────────────\n` +
      `• The Seller must deliver the agreed product or service as described in the deal.\n` +
      `• The Customer should only release funds after confirming receipt.\n` +
      `• After payout, the Customer may leave a review. Reviews must be honest and must not contain harassment, doxxing, or false accusations.\n` +
      `• Use /anonymous before submitting a review if you want to appear anonymous in public logs and review channels.\n\n` +
      `────────────────────────────────────────\n` +
      `5. STAFF & SUPPORT\n` +
      `────────────────────────────────────────\n` +
      `• Staff mediate deals; they do not guarantee outcomes. They may assist with disputes, refunds, releases, or channel management.\n` +
      `• Use the Staff button in your deal channel if you need help. Abuse of staff pings may result in restrictions.\n` +
      `• Do not impersonate staff, moderators, or the Nestoo bot.\n` +
      `• Staff may warn, mute, cancel deals, close channels, or remove members from the server.`,

    `────────────────────────────────────────\n` +
      `6. PRIVACY & SECURITY\n` +
      `────────────────────────────────────────\n` +
      `• Do not share private information unnecessarily.\n` +
      `• Never share your wallet seed phrase, private keys, or passwords with anyone — including staff.\n` +
      `• Screenshots, transcripts, and transaction IDs may be used for dispute resolution and record-keeping.\n` +
      `• Do not attempt to exploit, reverse-engineer, or abuse the bot or escrow system.\n\n` +
      `────────────────────────────────────────\n` +
      `7. PROHIBITED ACTIVITY\n` +
      `────────────────────────────────────────\n` +
      `• Scamming, fraud, or misrepresenting a product or payment\n` +
      `• Money laundering or illegal transactions\n` +
      `• Fake or duplicate deals to manipulate reviews or statistics\n` +
      `• Stealing funds, hijacking deals, or interfering with another user's transaction\n` +
      `• Encouraging trades outside escrow\n\n` +
      `Violations may result in immediate removal and a permanent ban.\n\n` +
      `────────────────────────────────────────\n` +
      `8. LIABILITY\n` +
      `────────────────────────────────────────\n` +
      `• Nestoo is a technical escrow middleman, not a legal party to your agreement.\n` +
      `• We do not guarantee the quality, legality, or delivery of any product or service.\n` +
      `• Users participate at their own risk and must verify who they trade with.\n` +
      `• The team may refuse service, cancel deals, or restrict access at any time.\n\n` +
      `────────────────────────────────────────\n` +
      `9. CHANGES\n` +
      `────────────────────────────────────────\n` +
      `These rules may be updated at any time. Continued use of the server means you accept the revised rules.\n\n` +
      `────────────────────────────────────────\n` +
      `10. ACKNOWLEDGEMENT\n` +
      `────────────────────────────────────────\n` +
      `By using Nestoo, you confirm that you have read these rules, will follow the official escrow process, accept staff decisions in disputes, and understand that blockchain transactions are irreversible.\n\n` +
      howtoFooterLine(howtoChannelId),
  ];
}

function buildContainerFromTexts(texts) {
  const container = new ContainerBuilder();
  for (let i = 0; i < texts.length; i++) {
    if (i > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(texts[i]));
  }
  return container;
}

function displayTextLength(texts) {
  return texts.reduce((sum, text) => sum + text.length, 0);
}

function buildRulesContainers(howtoChannelId = config.howtoChannelId) {
  const title = `# NESTOO - MIDDLEMAN — SERVER RULES`;
  const blocks = rulesTextBlocks(howtoChannelId);

  const groups = [[title, blocks[0]], [blocks[1]], [blocks[2]]];

  for (const group of groups) {
    if (displayTextLength(group) > MAX_DISPLAY_TEXT) {
      throw new Error("Rules panel exceeds Discord display text limit");
    }
  }

  return groups.map((texts) => buildContainerFromTexts(texts));
}

function buildRulesContainer(howtoChannelId = config.howtoChannelId) {
  return buildRulesContainers(howtoChannelId)[0];
}

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: `${e("error")}Permission denied. You need **Manage Server**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const containers = buildRulesContainers();

  await interaction.reply({
    content: `${e("success")}Server rules panel sent (${containers.length} message${containers.length > 1 ? "s" : ""}).`,
    flags: MessageFlags.Ephemeral,
  });

  for (const container of containers) {
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

module.exports = { data, execute, buildRulesContainer, buildRulesContainers };
