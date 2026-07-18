const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config");
const { isUserAnonymous, setUserAnonymous } = require("../utils/userPrefs");

const { e } = config;

const data = new SlashCommandBuilder()
  .setName("anonymous")
  .setDescription("Enable or disable anonymity in reviews and public logs")
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("Choose a mode")
      .setRequired(true)
      .addChoices(
        { name: "Enable", value: "on" },
        { name: "Disable", value: "off" },
        { name: "View my status", value: "status" }
      )
  );

async function execute(interaction) {
  const mode = interaction.options.getString("mode", true);
  const userId = interaction.user.id;

  if (mode === "status") {
    const anon = isUserAnonymous(userId);
    return interaction.reply({
      content: anon
        ? `${e("lock")}You are **anonymous** — your profile is hidden in reviews / public logs.`
        : `${e("users")}You are **visible** — your profile appears in reviews / public logs.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const anon = mode === "on";
  setUserAnonymous(userId, anon);

  return interaction.reply({
    content: anon
      ? `${e("lock")}Anonymity **enabled**. Your profile will be hidden in reviews and public logs.`
      : `${e("users")}Anonymity **disabled**. Your profile will show again in reviews and public logs.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
