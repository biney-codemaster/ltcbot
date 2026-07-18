const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config");
const { isUserAnonymous, setUserAnonymous } = require("../utils/userPrefs");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("anonyme")
  .setDescription("Active ou désactive l'anonymat dans les avis et logs publics")
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("Choisir le mode")
      .setRequired(true)
      .addChoices(
        { name: "Activer", value: "on" },
        { name: "Désactiver", value: "off" },
        { name: "Voir mon statut", value: "status" }
      )
  );

async function execute(interaction) {
  const mode = interaction.options.getString("mode", true);
  const userId = interaction.user.id;

  if (mode === "status") {
    const anon = isUserAnonymous(userId);
    return interaction.reply({
      content: anon
        ? `${e("lock")}Tu es **anonyme** — ton profil n'apparaît pas dans les avis / logs publics.`
        : `${e("users")}Tu es **visible** — ton profil apparaît dans les avis / logs publics.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const anon = mode === "on";
  setUserAnonymous(userId, anon);

  return interaction.reply({
    content: anon
      ? `${e("lock")}Anonymat **activé**. Tes avis et logs publics n'afficheront plus ton profil.`
      : `${e("users")}Anonymat **désactivé**. Ton profil réapparaîtra dans les avis et logs publics.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
