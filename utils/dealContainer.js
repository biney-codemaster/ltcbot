const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const config = require("../config");
const { formatLtcAmount } = require("./ltcPrice");
const { statusLabel, getExplorerTxUrl } = require("./ltcWallet");
const { formatAuthor } = require("./userPrefs");
const { dealCodeTag, formatCryptoAmountLine, discordTimestamp } = require("./dealLogger");

const { e, emojis } = config;

/** UI labels: buyer_id → Seller, seller_id → Customer */
const ROLE_PAYER = "Seller";
const ROLE_RECEIVER = "Customer";

function applyEmoji(button, key) {
  if (emojis[key]) button.setEmoji(emojis[key]);
  return button;
}

function dealTitle(deal) {
  return `# ${e("deal")}Deal #${dealCodeTag(deal.deal_code)}`;
}

function addTitleOnly(container, deal) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealTitle(deal)));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
}

function formatTxBlock(txid) {
  const id = String(txid || "").trim();
  if (!id) return null;
  if (/^[a-f0-9]{64}$/i.test(id)) {
    return `${e("info")}**TXID** — \`${id}\` · [Link](${getExplorerTxUrl(id)})`;
  }
  return `${e("info")}**TXID** — \`${id}\``;
}

function buildRoleSelectionContainer(deal) {
  const container = new ContainerBuilder();
  addTitleOnly(container, deal);

  const crypto = deal.crypto || "LTC";
  const amount = formatLtcAmount(Number(deal.pay_amount));
  const sellerLabel = deal.buyer_id ? `<@${deal.buyer_id}>` : "*pending*";
  const customerLabel = deal.seller_id ? `<@${deal.seller_id}>` : "*pending*";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${e("product")}**Product** — ${deal.product}\n` +
        `${e("money")}**Price** — ${deal.price}${deal.currency}` +
        (amount ? `\n${e("ltc")}**${crypto}** — \`${amount} ${crypto}\`` : "") +
        `\n\n## ${e("roles")}Choose your role\n` +
        `Each participant clicks **${ROLE_PAYER}** or **${ROLE_RECEIVER}**.\n\n` +
        `${e("buyer")}**${ROLE_PAYER}** — ${sellerLabel}\n` +
        `${e("seller")}**${ROLE_RECEIVER}** — ${customerLabel}\n\n` +
        `${e("lock")}Anonymity in reviews / public logs: \`/anonymous\``
    )
  );

  const sellerButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_role:BUYER:${deal.deal_code}`)
      .setLabel(ROLE_PAYER)
      .setStyle(deal.buyer_id ? ButtonStyle.Success : ButtonStyle.Secondary),
    "buyer"
  );

  const customerButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_role:SELLER:${deal.deal_code}`)
      .setLabel(ROLE_RECEIVER)
      .setStyle(deal.seller_id ? ButtonStyle.Success : ButtonStyle.Secondary),
    "seller"
  );

  const cancelButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_cancel:${deal.deal_code}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
    "cancel"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(sellerButton, customerButton, cancelButton)
  );

  return container;
}

function buildConfirmationContainer(deal) {
  const container = new ContainerBuilder();
  const confirmCount = (deal.initiator_confirmed ? 1 : 0) + (deal.partner_confirmed ? 1 : 0);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Confirm roles\n` +
        `${e("buyer")}**${ROLE_PAYER}** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**${ROLE_RECEIVER}** — <@${deal.seller_id}>\n\n` +
        `${e("warning")}Double-check before confirming.\n` +
        `${e("clock")}**${confirmCount}/2** confirmations`
    )
  );

  const confirmButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_confirm:${deal.deal_code}`)
      .setLabel(`Confirm (${confirmCount}/2)`)
      .setStyle(confirmCount === 2 ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(confirmCount === 2),
    "confirm"
  );

  const wrongRolesButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_wrong_roles:${deal.deal_code}`)
      .setLabel("Wrong roles")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(confirmCount === 2),
    "warning"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(confirmButton, wrongRolesButton)
  );

  return container;
}

function buildFinalRecapContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Roles confirmed\n` +
        `${e("buyer")}**${ROLE_PAYER}** — <@${deal.buyer_id}>\n` +
        `${e("seller")}**${ROLE_RECEIVER}** — <@${deal.seller_id}>\n\n` +
        `${e("next")}Generating payment address…`
    )
  );

  return container;
}

function buildPaymentContainer(deal) {
  const container = new ContainerBuilder();

  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const address = deal.pay_address || "*generating address*";
  const status = statusLabel(deal.payment_status || "waiting");
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("payment")}Escrow payment\n` +
        `${e("buyer")}<@${deal.buyer_id}> must send **exactly** the amount below.\n\n` +
        `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
        `${e("money")}**Price** — ${deal.price}${deal.currency}\n` +
        `${e("wallet")}**Address** — \`${address}\`\n` +
        `${e("clock")}**Status** — ${status}\n\n` +
        `${e("warning")}Send **${crypto}** only to this address.\n` +
        `${e("warning")}If the amount is **not exact**, **no refund** will be issued.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      applyEmoji(
        new ButtonBuilder()
          .setCustomId(`deal_dispute:${deal.deal_code}`)
          .setLabel("Open a dispute")
          .setStyle(ButtonStyle.Danger),
        "dispute"
      )
    )
  );
  return container;
}

function buildPaymentSetupErrorContainer(deal, errorMessage) {
  const container = new ContainerBuilder();

  const isMin =
    /montant trop|too small|minimum|frais réseau|network fee|DUST|solde trop bas|balance too low/i.test(
      String(errorMessage || "")
    );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Address unavailable\n` +
        `\`${errorMessage || "unknown error"}\`\n\n` +
        (isMin
          ? `${e("info")}Amount too low for Litecoin network fees — raise the price slightly.`
          : `${e("next")}Try again: a new address will be generated.`)
    )
  );

  const retryButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_regen_payment:${deal.deal_code}`)
      .setLabel("Regenerate address")
      .setStyle(ButtonStyle.Primary),
    "payment"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(retryButton));
  return container;
}

function buildPaymentDetectedContainer(deal) {
  const container = new ContainerBuilder();
  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("clock")}Payment detected\n` +
        `${e("success")}A payment was detected on the escrow address.\n\n` +
        `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
        `${e("clock")}Waiting for **blockchain confirmation**…\n\n` +
        `${e("info")}The next message will appear once the payment is confirmed.`
    )
  );

  return container;
}

function buildPaymentRetryContainer(deal) {
  const container = new ContainerBuilder();
  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const address = deal.pay_address || "*address pending*";
  const crypto = deal.crypto || "LTC";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("warning")}Incorrect amount\n` +
        `The amount received does not match the exact amount required.\n` +
        `${e("warning")}**No refund** will be issued.\n\n` +
        `${e("buyer")}<@${deal.buyer_id}> — send **exactly**:\n\n` +
        `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
        `${e("wallet")}**Address** — \`${address}\`\n\n` +
        `${e("warning")}Send **${crypto}** only to this address.`
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      applyEmoji(
        new ButtonBuilder()
          .setCustomId(`deal_dispute:${deal.deal_code}`)
          .setLabel("Open a dispute")
          .setStyle(ButtonStyle.Danger),
        "dispute"
      )
    )
  );
  return container;
}

function buildPaymentFailedContainer(deal, reason) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("error")}Payment not completed\n` +
        `Status: **${reason}**\n\n` +
        `${e("next")}Generate a new address, or contact staff if funds were already sent.`
    )
  );

  const retryButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_regen_payment:${deal.deal_code}`)
      .setLabel("New address")
      .setStyle(ButtonStyle.Primary),
    "payment"
  );

  const disputeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_dispute:${deal.deal_code}`)
      .setLabel("Open a dispute")
      .setStyle(ButtonStyle.Danger),
    "dispute"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(retryButton, disputeButton)
  );

  return container;
}

function buildFundsHeldContainer(deal) {
  const container = new ContainerBuilder();

  const walletLine = deal.seller_wallet
    ? `${e("wallet")}**Customer address** — \`${deal.seller_wallet}\``
    : `${e("warning")}**Customer address** — required (**customer only**)`;

  const payoutErrorLine = deal.payout_error
    ? `\n\n${e("error")}**Last payout failed** — \`${deal.payout_error}\``
    : "";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Payment confirmed\n` +
        `${e("shield")}Funds received and secured in **escrow**.\n\n` +
        `${e("seller")}<@${deal.seller_id}> — deliver the product.\n` +
        `${e("buyer")}<@${deal.buyer_id}> — confirm only after you receive it.\n\n` +
        `${walletLine}${payoutErrorLine}\n\n` +
        `${e("lock")}Anonymity: \`/anonymous\``
    )
  );

  const walletButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_seller_wallet:${deal.deal_code}`)
      .setLabel(deal.seller_wallet ? "Update address (customer)" : "Customer address")
      .setStyle(ButtonStyle.Secondary),
    "wallet"
  );

  const releaseButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_release:${deal.deal_code}`)
      .setLabel(deal.payout_error ? "Retry release" : "Product received — release")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!deal.seller_wallet),
    "release"
  );

  const disputeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_dispute:${deal.deal_code}`)
      .setLabel("Open a dispute")
      .setStyle(ButtonStyle.Danger),
    "dispute"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(walletButton, releaseButton, disputeButton)
  );

  return container;
}

function buildReleasedContainer(deal) {
  const container = new ContainerBuilder();

  const wallet = deal.seller_wallet || "—";
  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  let body;
  if (deal.payout_error) {
    body =
      `${e("error")}Payout failed: \`${deal.payout_error}\`\n` +
      `${e("staff")}Manual release possible to \`${wallet}\`.`;
  } else {
    body =
      `${e("success")}Payout broadcast on Litecoin.\n\n` +
      `${e("wallet")}**Address** — \`${wallet}\`\n` +
      `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
      `${e("clock")}**Status** — ${statusLabel(deal.payout_status || "processing")}\n` +
      (txBlock ? `${txBlock}\n` : "") +
      `\n${e("clock")}Awaiting blockchain confirmation…`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${e("release")}Payout in progress\n${body}`)
  );

  return container;
}

function buildPayoutConfirmedContainer(deal) {
  const container = new ContainerBuilder();

  const wallet = deal.seller_wallet || "—";
  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Payout sent\n` +
        `${e("release")}Funds **confirmed** on the blockchain.\n\n` +
        `${e("wallet")}**Address** — \`${wallet}\`\n` +
        `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
        (txBlock ? `${txBlock}\n\n` : "\n") +
        `${e("next")}The seller leaves a review to close the deal.`
    )
  );

  return container;
}

function buildReviewRequestContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("confirm")}Your review\n` +
        `${e("buyer")}<@${deal.buyer_id}> — leave a rating and a short review.\n\n` +
        `${e("lock")}Anonymity: \`/anonymous\`\n` +
        `${e("clock")}This channel closes after the review.`
    )
  );

  const reviewButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_review:${deal.deal_code}`)
      .setLabel("Leave a review")
      .setStyle(ButtonStyle.Primary),
    "confirm"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(reviewButton));
  return container;
}

function buildPublicReviewContainer(deal, { botId } = {}) {
  const container = new ContainerBuilder();
  const stars =
    deal.review_rating != null
      ? `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - Number(deal.review_rating))}`
      : "—";
  const authorLine = `${e("users")}**Customer** — ${formatAuthor(deal.buyer_id, {
    anonymous: Boolean(deal.review_anonymous),
  })}`;
  const botMention = botId ? `<@${botId}>` : "the bot";
  const when = discordTimestamp(deal.review_at || deal.completed_at || new Date().toISOString());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${e("confirm")}New review`)
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${authorLine}\n` +
        `${e("escrow")}Review for ${botMention}\n` +
        `${e("ltc")}${formatCryptoAmountLine(deal)}\n` +
        `${e("confirm")}**Rating** — ${stars}\n\n` +
        `**Note**\n${deal.review_text || "*No text*"}\n\n` +
        `${e("clock")}${when}`
    )
  );
  return container;
}

function buildReviewPostedContainer(deal) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("success")}Review saved\n` +
        `${e("confirm")}Thanks — the deal is closed.\n` +
        `${e("close")}Closing the channel…`
    )
  );
  return container;
}

function buildDisputeContainer(deal, openedBy) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("dispute")}Dispute opened\n` +
        `Opened by <@${openedBy}>.\n\n` +
        `**Reason**\n${deal.dispute_reason || "*not specified*"}\n\n` +
        `${e("staff")}Staff actions:\n` +
        `• **Release to customer**\n` +
        `• **Refund seller**\n` +
        `• **Close** without transfer`
    )
  );

  const releaseButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_release:${deal.deal_code}`)
      .setLabel("Release to customer")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!deal.seller_wallet),
    "release"
  );

  const refundButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_refund:${deal.deal_code}`)
      .setLabel("Refund seller")
      .setStyle(ButtonStyle.Primary),
    "money"
  );

  const resolveButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_staff_resolve:${deal.deal_code}`)
      .setLabel("Close without payout")
      .setStyle(ButtonStyle.Secondary),
    "staff"
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(releaseButton, refundButton, resolveButton)
  );
  return container;
}

function buildRefundPendingContainer(deal) {
  const container = new ContainerBuilder();
  const wallet = deal.buyer_wallet || "—";
  const amount =
    formatLtcAmount(Number(deal.expected_pay_amount || deal.pay_amount)) || "—";
  const crypto = deal.crypto || "LTC";
  const txBlock = formatTxBlock(deal.payout_id);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${e("money")}Refund in progress\n` +
        `${e("success")}Seller refund broadcast on Litecoin.\n\n` +
        `${e("buyer")}**Seller** — <@${deal.buyer_id}>\n` +
        `${e("wallet")}**Address** — \`${wallet}\`\n` +
        `${e("ltc")}**Amount** — \`${amount} ${crypto}\`\n` +
        `${e("clock")}**Status** — ${statusLabel(deal.payout_status || "processing")}\n` +
        (txBlock ? `${txBlock}\n` : "") +
        `\n${e("clock")}Awaiting blockchain confirmation…`
    )
  );

  return container;
}

function buildCloseTicketContainer(deal, byUserId, { reason = "cancelled" } = {}) {
  const container = new ContainerBuilder();

  let body;
  if (reason === "refunded") {
    body =
      `## ${e("success")}Refund confirmed\n` +
      `${e("money")}Funds were returned to the seller.\n` +
      (byUserId ? `Handled by <@${byUserId}>.\n\n` : "\n") +
      `${e("staff")}A staff member can close this channel.`;
  } else {
    body =
      `## ${e("cancel")}Deal cancelled\n` +
      (byUserId ? `Cancelled by <@${byUserId}>.\n\n` : "\n") +
      `${e("staff")}A staff member must close this channel.`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  const closeButton = applyEmoji(
    new ButtonBuilder()
      .setCustomId(`deal_close:${deal.deal_code}`)
      .setLabel("Close channel")
      .setStyle(ButtonStyle.Danger),
    "close"
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(closeButton));
  return container;
}

module.exports = {
  ROLE_PAYER,
  ROLE_RECEIVER,
  buildRoleSelectionContainer,
  buildConfirmationContainer,
  buildFinalRecapContainer,
  buildPaymentContainer,
  buildPaymentSetupErrorContainer,
  buildPaymentDetectedContainer,
  buildPaymentRetryContainer,
  buildPaymentFailedContainer,
  buildFundsHeldContainer,
  buildReleasedContainer,
  buildPayoutConfirmedContainer,
  buildReviewRequestContainer,
  buildPublicReviewContainer,
  buildReviewPostedContainer,
  buildDisputeContainer,
  buildRefundPendingContainer,
  buildCloseTicketContainer,
  formatTxBlock,
};
