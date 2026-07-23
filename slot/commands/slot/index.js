const {
  SlashCommandBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('../../config');
const slotService = require('../../services/slotService');
const keyService = require('../../services/keyService');
const {
  addSlotRole,
  removeSlotRole,
  sendLog,
  postSlotGuide,
  deleteSlotChannel,
} = require('../../services/guildActions');
const { provisionSlot } = require('../../services/provision');
const {
  assertCanActivateFree,
} = require('../../services/slotPayment');
const { getPlan } = require('../../plans');
const { isOwner } = require('../../utils/helpers');
const {
  slotEmbed,
  listEmbed,
  successEmbed,
  errorEmbed,
  panelEmbed,
  freeKeyPanelEmbed,
  paidPlansPanelEmbed,
} = require('../../utils/embeds');

function denyOwner() {
  return {
    embeds: [errorEmbed('Only the bot owner can use this command.')],
    ephemeral: true,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slot')
    .setDescription('Vendor slot system')
    .addSubcommand((sub) =>
      sub
        .setName('activate')
        .setDescription('Activate your free slot with a key')
        .addStringOption((opt) =>
          opt
            .setName('key')
            .setDescription('Your free slot key')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a vendor slot and private channel (owner)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Seller').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('days')
            .setDescription('Duration in days')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(365)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('everyone_pings')
            .setDescription('Max @everyone pings per day (Paris midnight reset)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(50)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('here_pings')
            .setDescription('Max @here pings per day (Paris midnight reset)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(50)
        )
        .addStringOption((opt) =>
          opt
            .setName('plan')
            .setDescription('Counts toward free (10) or paid (15) cap')
            .setRequired(false)
            .addChoices(
              { name: 'Free', value: 'free' },
              { name: 'Standard (paid)', value: 'standard' },
              { name: 'Boost (paid)', value: 'boost' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('renew')
        .setDescription('Renew a slot (owner)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Seller').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('days')
            .setDescription('Days to add')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(365)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a slot (owner)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Seller').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all active slots (owner)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Show slot details (owner)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Seller').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Configure the bot (owner)')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role given to slot holders').setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('logs')
            .setDescription('Log channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('category')
            .setDescription('Category for new slot channels')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('everyone_pings')
            .setDescription('Default @everyone pings / day')
            .setMinValue(0)
            .setMaxValue(50)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('here_pings')
            .setDescription('Default @here pings / day')
            .setMinValue(0)
            .setMaxValue(50)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('expiry_dm_hours')
            .setDescription(
              'Hours before expiry to DM the seller a reminder (e.g. 24 = 1 day before)'
            )
            .setMinValue(1)
            .setMaxValue(168)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Show the admin panel (owner)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('keypanel')
        .setDescription('Post the free key claim panel (owner)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('buypanel')
        .setDescription('Post the paid plans panel (owner)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('repostguide')
        .setDescription('Repost the slot rules panel in a seller channel (owner)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Slot owner').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'activate') {
      const keyCode = interaction.options.getString('key', true);
      const record = keyService.getKeyByCode(keyCode);

      if (!record || record.guild_id !== guildId) {
        return interaction.reply({
          embeds: [errorEmbed('Invalid key for this server.')],
          ephemeral: true,
        });
      }

      if (record.user_id !== interaction.user.id) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              'This key does not belong to you.\nFree keys are unique and non-transferable.'
            ),
          ],
          ephemeral: true,
        });
      }

      if (record.used_at) {
        return interaction.reply({
          embeds: [errorEmbed('This key has already been used.')],
          ephemeral: true,
        });
      }

      if (slotService.getSlot(guildId, interaction.user.id)) {
        return interaction.reply({
          embeds: [errorEmbed('You already have an active slot.')],
          ephemeral: true,
        });
      }

      const freeGate = assertCanActivateFree(guildId);
      if (!freeGate.ok) {
        return interaction.reply({
          embeds: [errorEmbed(freeGate.error)],
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await provisionSlot(interaction.guild, interaction.user, {
        planId: 'free',
        days: config.freeSlotDays,
        everyonePings: config.freeEveryonePings,
        herePings: config.freeHerePings,
        title: 'Free slot activated',
      });

      if (result.error) {
        return interaction.editReply({ embeds: [errorEmbed(result.error)] });
      }

      keyService.markKeyUsed(record.id);

      return interaction.editReply({
        embeds: [
          successEmbed(
            `Slot ready: <#${result.slot.channel_id}>\n` +
              `**${config.freeSlotDays}d** · **${config.freeEveryonePings}** @everyone · **${config.freeHerePings}** @here / day\n` +
              'Over ping limit = revoked.'
          ),
          slotEmbed(result.slot, 'Your slot'),
        ],
      });
    }

    if (!isOwner(interaction.user.id, config.ownerId)) {
      return interaction.reply(denyOwner());
    }

    if (sub === 'create') {
      const user = interaction.options.getUser('user', true);
      const days = interaction.options.getInteger('days', true);
      const everyonePings = interaction.options.getInteger('everyone_pings', true);
      const herePings = interaction.options.getInteger('here_pings', true);
      const planId = interaction.options.getString('plan') || 'standard';
      const plan = getPlan(planId) || getPlan('standard');

      if (slotService.getSlot(guildId, user.id)) {
        return interaction.reply({
          embeds: [
            errorEmbed(`<@${user.id}> already has a slot. Use \`/slot renew\`.`),
          ],
          ephemeral: true,
        });
      }

      if (plan.paid && slotService.countPaidSlots(guildId) >= config.maxPaidSlots) {
        return interaction.reply({
          embeds: [errorEmbed(`Paid slots full (${config.maxPaidSlots}).`)],
          ephemeral: true,
        });
      }
      if (!plan.paid && slotService.countFreeSlots(guildId) >= config.maxFreeSlots) {
        return interaction.reply({
          embeds: [errorEmbed(`Free slots full (${config.maxFreeSlots}).`)],
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await provisionSlot(interaction.guild, user, {
        planId: plan.id,
        days,
        everyonePings,
        herePings,
        title: 'New slot',
      });

      if (result.error) {
        return interaction.editReply({ embeds: [errorEmbed(result.error)] });
      }

      return interaction.editReply({
        embeds: [slotEmbed(result.slot, 'Slot created')],
      });
    }

    if (sub === 'renew') {
      const user = interaction.options.getUser('user', true);
      const days = interaction.options.getInteger('days', true);
      const slot = slotService.renewSlot(guildId, user.id, days);

      if (!slot) {
        return interaction.reply({
          embeds: [errorEmbed(`No slot found for <@${user.id}>.`)],
          ephemeral: true,
        });
      }

      const settings = slotService.getSettings(guildId);
      await addSlotRole(interaction.guild, user.id, settings.slot_role_id);
      await sendLog(interaction.guild, `Slot renewed for <@${user.id}> (+${days}d).`, [
        slotEmbed(slot, 'Slot renewed'),
      ]);

      return interaction.reply({
        embeds: [slotEmbed(slot, 'Slot renewed')],
        ephemeral: true,
      });
    }

    if (sub === 'delete') {
      const user = interaction.options.getUser('user', true);
      const slot = slotService.deleteSlot(guildId, user.id);

      if (!slot) {
        return interaction.reply({
          embeds: [errorEmbed(`No slot found for <@${user.id}>.`)],
          ephemeral: true,
        });
      }

      const settings = slotService.getSettings(guildId);
      await removeSlotRole(interaction.guild, user.id, settings.slot_role_id);
      await deleteSlotChannel(interaction.guild, slot.channel_id);
      await sendLog(interaction.guild, `Slot deleted for <@${user.id}>.`, [
        slotEmbed(slot, 'Slot deleted'),
      ]);

      return interaction.reply({
        embeds: [successEmbed(`Slot for <@${user.id}> has been deleted.`)],
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const slots = slotService.listSlots(guildId);
      return interaction.reply({
        embeds: [listEmbed(slots)],
        ephemeral: true,
      });
    }

    if (sub === 'info') {
      const user = interaction.options.getUser('user', true);
      const slot = slotService.getSlot(guildId, user.id);

      if (!slot) {
        return interaction.reply({
          embeds: [errorEmbed(`No slot found for <@${user.id}>.`)],
          ephemeral: true,
        });
      }

      const pings = slotService.getPingCounts(slot.id);
      const embed = slotEmbed(slot).addFields({
        name: 'Pings used today (Paris)',
        value:
          `@everyone: **${pings.everyone} / ${slot.max_everyone_pings}**\n` +
          `@here: **${pings.here} / ${slot.max_here_pings}**`,
        inline: false,
      });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'config') {
      const role = interaction.options.getRole('role');
      const logs = interaction.options.getChannel('logs');
      const category = interaction.options.getChannel('category');
      const everyonePings = interaction.options.getInteger('everyone_pings');
      const herePings = interaction.options.getInteger('here_pings');
      const expiryDmHours = interaction.options.getInteger('expiry_dm_hours');

      if (
        !role &&
        !logs &&
        !category &&
        everyonePings == null &&
        herePings == null &&
        expiryDmHours == null
      ) {
        const settings = slotService.getSettings(guildId);
        return interaction.reply({
          embeds: [panelEmbed(settings, slotService.listSlots(guildId).length)],
          ephemeral: true,
        });
      }

      const patch = {};
      if (role) patch.slot_role_id = role.id;
      if (logs) patch.log_channel_id = logs.id;
      if (category) patch.category_id = category.id;
      if (everyonePings != null) patch.default_everyone_pings = everyonePings;
      if (herePings != null) patch.default_here_pings = herePings;
      if (expiryDmHours != null) patch.warn_hours = expiryDmHours;

      const settings = slotService.upsertSettings(guildId, patch);

      return interaction.reply({
        embeds: [
          successEmbed('Configuration updated.').addFields(
            {
              name: 'Slot role',
              value: settings.slot_role_id ? `<@&${settings.slot_role_id}>` : 'Not set',
              inline: true,
            },
            {
              name: 'Log channel',
              value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'Not set',
              inline: true,
            },
            {
              name: 'Category',
              value: settings.category_id ? `<#${settings.category_id}>` : 'Not set',
              inline: true,
            },
            {
              name: 'Default @everyone',
              value: String(settings.default_everyone_pings),
              inline: true,
            },
            {
              name: 'Default @here',
              value: String(settings.default_here_pings),
              inline: true,
            },
            {
              name: 'Expiry DM notice',
              value: `${settings.warn_hours}h before expiry`,
              inline: true,
            }
          ),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'panel') {
      const settings = slotService.getSettings(guildId);
      const slots = slotService.listSlots(guildId);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('slotpanel:list')
          .setLabel('List slots')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('slotpanel:refresh')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        embeds: [panelEmbed(settings, slots.length)],
        components: [row],
        ephemeral: true,
      });
    }

    if (sub === 'keypanel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('slotkey:claim')
          .setLabel('Claim free key')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        embeds: [freeKeyPanelEmbed()],
        components: [row],
      });

      return interaction.reply({
        embeds: [successEmbed('Free key panel posted in this channel.')],
        ephemeral: true,
      });
    }

    if (sub === 'buypanel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('slotbuy:plan:standard')
          .setLabel('Standard · €1.5')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('slotbuy:plan:boost')
          .setLabel('Boost · €4')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        embeds: [paidPlansPanelEmbed(guildId)],
        components: [row],
      });

      return interaction.reply({
        embeds: [successEmbed('Paid plans panel posted in this channel.')],
        ephemeral: true,
      });
    }

    if (sub === 'repostguide') {
      const user = interaction.options.getUser('user', true);
      const slot = slotService.getSlot(guildId, user.id);

      if (!slot) {
        return interaction.reply({
          embeds: [errorEmbed(`No slot found for <@${user.id}>.`)],
          ephemeral: true,
        });
      }

      if (!slot.channel_id) {
        return interaction.reply({
          embeds: [errorEmbed('This slot has no channel.')],
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels
        .fetch(slot.channel_id)
        .catch(() => null);

      if (!channel?.isTextBased()) {
        return interaction.reply({
          embeds: [errorEmbed('Could not find the slot channel.')],
          ephemeral: true,
        });
      }

      await postSlotGuide(channel, slot);

      return interaction.reply({
        embeds: [successEmbed(`Guide reposted in <#${channel.id}>.`)],
        ephemeral: true,
      });
    }
  },
};
