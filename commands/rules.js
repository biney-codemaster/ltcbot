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
    `${e("info")}**Need help?** Read the ${channelRef} channel, then use the **Staff** button in your deal if something goes wrong.\n\n` +
    `-# Thank you for helping keep **Nestoo** safe and professional.`
  );
}

function getRulesSections(howtoChannelId) {
  return [
    { content: `# ${e("shield")}NESTOO - MIDDLEMAN — SERVER RULES` },
    {
      content:
        `${e("info")}Welcome to **Nestoo**.\n` +
        `This server provides a **Litecoin (LTC) escrow** service to help buyers and sellers complete deals safely.\n\n` +
        `By joining and using this server, you agree to follow these rules __at all times__.`,
    },
    {
      content:
        `## ${e("users")}1. GENERAL CONDUCT\n` +
        `• Treat all members and staff with **respect**. Harassment, hate speech, threats, discrimination, or targeted abuse will **not** be tolerated.\n` +
        `• Do **not** spam, flood channels, advertise without permission, or disrupt the server.\n` +
        `• Do **not** share illegal content, malware, phishing links, or anything that violates Discord's Terms of Service or Community Guidelines.\n` +
        `• **English** is the primary language for support and deal communication unless staff say otherwise.`,
    },
    {
      content:
        `## ${e("escrow")}2. ESCROW & DEAL RULES\n` +
        `${e("deal")}Use the **official deal flow** only. Start deals through the designated panel and follow the bot instructions.\n\n` +
        `${e("roles")}**Choose your role carefully.**\n` +
        `${e("buyer")}**Customer** — pays into escrow.\n` +
        `${e("seller")}**Seller** — delivers and receives the payout.\n` +
        `Both sides must confirm roles **before payment**.\n\n` +
        `${e("ltc")}Send the **exact LTC amount** shown. Underpayments or overpayments may **not** be refunded automatically. Always double-check the address and amount.\n\n` +
        `${e("warning")}Do **not** send funds outside the escrow address provided in your deal channel unless staff instruct you to.\n` +
        `Do **not** bypass escrow, rush a release, or pressure the other party before delivery is complete.\n\n` +
        `${e("cancel")}Cancellation is only available **before a payment address is generated**, through the official process in the deal channel.\n\n` +
        `${e("staff")}Staff decisions are **final** in disputes, refunds, releases, or deal cancellations when mediation is required.`,
    },
    {
      content:
        `## ${e("money")}3. PAYMENTS & FEES\n` +
        `${e("success")}**0 service fees** — only Litecoin network fees apply.\n\n` +
        `${e("buyer")}The **Customer** is responsible for sending the correct amount to the correct address.\n` +
        `${e("payment")}Once funds are confirmed on-chain and held in escrow, the deal follows the agreed terms and bot workflow.\n\n` +
        `${e("warning")}Nestoo is **not** responsible for user error *(wrong address, wrong amount, wrong network, or third-party wallet issues)*.`,
    },
    {
      content:
        `## ${e("release")}4. DELIVERY, RELEASE & REVIEWS\n` +
        `${e("seller")}The **Seller** must deliver the agreed product or service as described in the deal.\n` +
        `${e("buyer")}The **Customer** should only release funds **after confirming receipt**.\n\n` +
        `${e("confirm")}After payout, the Customer may leave a review. Reviews must be **honest** and must **not** contain harassment, doxxing, or false accusations.\n\n` +
        `${e("lock")}Use \`/anonymous\` before submitting a review if you want to appear anonymous in public logs and review channels.`,
    },
    {
      content:
        `## ${e("staff")}5. STAFF & SUPPORT\n` +
        `${e("info")}Staff **mediate** deals; they do **not** guarantee outcomes. They may assist with disputes, refunds, releases, or channel management.\n\n` +
        `${e("staff")}Use the **Staff** button in your deal channel if you need help. Abuse of staff pings may result in **restrictions**.\n` +
        `Do **not** impersonate staff, moderators, or the **Nestoo bot**.\n\n` +
        `${e("warning")}Staff may warn, mute, cancel deals, close channels, or remove members from the server.`,
    },
    {
      content:
        `## ${e("lock")}6. PRIVACY & SECURITY\n` +
        `• Do **not** share private information unnecessarily.\n` +
        `• __Never__ share your wallet seed phrase, private keys, or passwords with anyone — **including staff**.\n` +
        `• Screenshots, transcripts, and transaction IDs may be used for dispute resolution and record-keeping.\n` +
        `• Do **not** attempt to exploit, reverse-engineer, or abuse the bot or escrow system.`,
    },
    {
      content:
        `## ${e("warning")}7. PROHIBITED ACTIVITY\n` +
        `• **Scamming**, fraud, or misrepresenting a product or payment\n` +
        `• **Money laundering** or illegal transactions\n` +
        `• **Fake or duplicate deals** to manipulate reviews or statistics\n` +
        `• **Stealing funds**, hijacking deals, or interfering with another user's transaction\n` +
        `• **Encouraging trades outside escrow**\n\n` +
        `> Violations may result in __immediate removal__ and a __permanent ban__.`,
    },
    {
      content:
        `## ${e("info")}8. LIABILITY\n` +
        `• Nestoo is a **technical escrow middleman**, not a legal party to your agreement.\n` +
        `• We do **not** guarantee the quality, legality, or delivery of any product or service.\n` +
        `• Users participate **at their own risk** and must verify who they trade with.\n` +
        `• The team may refuse service, cancel deals, or restrict access at any time.`,
    },
    {
      content:
        `## ${e("clock")}9. CHANGES\n` +
        `These rules may be updated at any time. **Continued use** of the server means you accept the revised rules.`,
    },
    {
      content:
        `## ${e("confirm")}10. ACKNOWLEDGEMENT\n` +
        `By using **Nestoo**, you confirm that you:\n` +
        `• Have **read** these rules\n` +
        `• Will follow the **official escrow process**\n` +
        `• Accept **staff decisions** in disputes\n` +
        `• Understand that **blockchain transactions are irreversible**`,
    },
    { content: howtoFooterLine(howtoChannelId) },
  ];
}

function addSeparator(container) {
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
}

function buildRulesContainers(howtoChannelId = config.howtoChannelId) {
  const sections = getRulesSections(howtoChannelId);
  const containers = [];
  let current = null;
  let currentLen = 0;

  for (const section of sections) {
    const len = section.content.length;
    if (current && currentLen + len > MAX_DISPLAY_TEXT) {
      containers.push(current);
      current = null;
      currentLen = 0;
    }

    if (!current) {
      current = new ContainerBuilder();
    } else {
      addSeparator(current);
    }

    current.addTextDisplayComponents(new TextDisplayBuilder().setContent(section.content));
    currentLen += len;
  }

  if (current) {
    containers.push(current);
  }

  return containers;
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
