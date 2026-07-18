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
 * Après avis acheteur : publie l'avis, logs public/admin, transcript, ferme le salon.
 */
async function finalizeDealAfterReview(client, deal, { reviewContainer }) {
  const dealCode = deal.deal_code;
  const botId = client.user?.id;

  // Publier l'avis (container V2, fallback texte)
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
          console.warn("Avis V2 KO, fallback texte:", err.message);
          const stars = `${"★".repeat(deal.review_rating)}${"☆".repeat(5 - deal.review_rating)}`;
          await reviewsCh.send({
            content:
              `**Nouvel avis** — Rating ${stars}\n` +
              `Auteur — ${deal.review_anonymous ? "Anonyme" : `<@${deal.buyer_id}>`}\n` +
              `Avis pour ${botId ? `<@${botId}>` : "le bot"}\n` +
              `${formatCryptoAmountLine(deal)}\n\n` +
              `**Note**\n${deal.review_text}`,
          });
        }
      }
    } catch (err) {
      console.warn("Publication avis:", err.message);
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
  await logAdmin(client, `Deal complété #${dealCodeTag(dealCode)}`, [
    `${e("success")}Avis reçu — deal clôturé`,
    `${e("product")}**Produit** — ${completed.product}`,
    `${e("ltc")}${formatCryptoAmountLine(completed)}`,
    `${e("confirm")}**Rating** — ${completed.review_rating}/5`,
    `${e("users")}**Anonyme** — ${completed.review_anonymous ? "oui" : "non"}`,
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
      await logAdmin(client, `Transcript KO #${dealCodeTag(dealCode)}`, [
        `${e("error")}${err.message}`,
      ]);
    }

    await channel
      .send({
        content: `${e("close")}Deal terminé — fermeture du salon dans 10 secondes…`,
      })
      .catch(() => {});

    setTimeout(() => {
      channel.delete(`Deal #${dealCode} complété`).catch(() => {});
    }, 10_000);
  }

  return completed;
}

module.exports = { finalizeDealAfterReview };
