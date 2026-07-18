const { MessageFlags } = require("discord.js");
const db = require("../database");
const config = require("../config");
const {
  logAdmin,
  logPublicCompleted,
  dealCodeTag,
  formatTxidLine,
  formatBuyerSellerLines,
  formatCryptoAmountLine,
} = require("./dealLogger");
const { deliverTranscripts } = require("./transcript");
const { buildReviewPostedContainer } = require("./dealContainer");

const { e } = config;

/**
 * After seller review: publish review, public/admin logs, transcript, close channel.
 */
async function finalizeDealAfterReview(client, deal, { reviewContainer }) {
  const dealCode = deal.deal_code;
  const botId = client.user?.id;

  if (config.reviewsChannelId && reviewContainer) {
    try {
      const reviewsCh = await client.channels.fetch(config.reviewsChannelId);
      if (reviewsCh?.isTextBased()) {
        try {
          await reviewsCh.send({
            components: [reviewContainer],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch (err) {
          console.warn("Review V2 failed, text fallback:", err.message);
          const stars = `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - deal.review_rating)}`;
          await reviewsCh.send({
            content:
              `**New review** — Rating ${stars}\n` +
              `Customer — ${deal.review_anonymous ? "Anonymous" : `<@${deal.buyer_id}>`}\n` +
              `Review for ${botId ? `<@${botId}>` : "the bot"}\n` +
              `${formatCryptoAmountLine(deal)}\n\n` +
              `**Note**\n${deal.review_text}`,
          });
        }
      }
    } catch (err) {
      console.warn("Review publish:", err.message);
    }
  }

  db.prepare(
    `UPDATE deals
     SET status = 'completed',
         completed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE deal_code = ?`
  ).run(dealCode);

  const completed = db.prepare("SELECT * FROM deals WHERE deal_code = ?").get(dealCode);

  await logPublicCompleted(client, completed);
  await logAdmin(client, `Deal completed #${dealCodeTag(dealCode)}`, [
    `${e("success")}Review received — deal closed`,
    `${e("product")}**Product** — ${completed.product}`,
    `${e("ltc")}${formatCryptoAmountLine(completed)}`,
    `${e("confirm")}**Rating** — ${completed.review_rating}/5`,
    `${e("users")}**Anonymous** — ${completed.review_anonymous ? "yes" : "no"}`,
    ...formatBuyerSellerLines(completed),
    formatTxidLine(completed.payout_id),
  ]);

  let channel = null;
  if (completed.channel_id) {
    try {
      channel = await client.channels.fetch(completed.channel_id);
    } catch {
      channel = null;
    }
  }

  if (channel?.isTextBased()) {
    await channel
      .send({
        components: [buildReviewPostedContainer(completed)],
        flags: MessageFlags.IsComponentsV2,
      })
      .catch(() => {});

    try {
      await deliverTranscripts(client, channel, completed);
    } catch (err) {
      console.error(`Transcript #${dealCode}:`, err.message);
      await logAdmin(client, `Transcript failed #${dealCodeTag(dealCode)}`, [
        `${e("error")}${err.message}`,
      ]);
    }

    await channel
      .send({
        content: `${e("close")}Deal finished — closing channel in 10 seconds…`,
      })
      .catch(() => {});

    setTimeout(() => {
      channel.delete(`Deal #${dealCode} completed`).catch(() => {});
    }, 10_000);
  }

  return completed;
}

module.exports = { finalizeDealAfterReview };
