const { parseDuration } = require("../lib/parseDuration");
const { name: PLUGIN_NAME, configSchema } = require("../plugin.json");

// Capture dependencies at load time; execute's second argument is the client,
// not the plugin context. Both runtimes support the model query API used here.
function createRemindCommand(ReminderModel, db) {
	return {
		data: {
			name: "remind",
			description: "Manage personal reminders",
			dm_permission: false,
			options: [
				{
					name: "set",
					description: "Set a new reminder",
					type: 1, // SUB_COMMAND
					options: [
						{
							name: "time",
							type: 3, // STRING
							description: "When to remind you, e.g. 30s, 10m, 2h, 1d",
							required: true,
						},
						{
							name: "message",
							type: 3,
							description: "What to remind you about",
							required: true,
							min_length: 1,
							max_length: 1000,
						},
					],
				},
				{
					name: "list",
					description: "List your pending reminders",
					type: 1,
					options: [{ name: "page", description: "Page number", type: 4, min_value: 1 }], // INTEGER
				},
				{
					name: "cancel",
					description: "Cancel a reminder",
					type: 1,
					options: [
						{
							name: "id",
							type: 3,
							description: "Reminder ID (from /remind list)",
							required: true,
						},
					],
				},
			],
		},
		async execute(interaction) {
			if (!interaction.guildId) return interaction.reply({ content: "Use this command in a server.", ephemeral: true });
			const subcommand = interaction.options.getSubcommand();

			if (subcommand === "set") {
				const timeInput = interaction.options.getString("time");
				const message = interaction.options.getString("message");
				const ms = parseDuration(timeInput);
				const remindAt = new Date(Date.now() + (ms || 0));

				if (!ms || !Number.isFinite(remindAt.getTime())) {
					return interaction.reply({
						content: "Invalid time format. Use e.g. `30s`, `10m`, `2h`, `1d`.",
						ephemeral: true,
					});
				}
				if (typeof message !== "string" || !message.trim() || message.length > 1000) {
					return interaction.reply({ content: "Reminder message must contain 1-1000 characters and cannot be empty.", ephemeral: true });
				}

				const config = await db.getPluginConfig(interaction.guildId, PLUGIN_NAME);
				const configuredMax = config?.data?.maxPerUser;
				const limits = configSchema.properties.maxPerUser;
				const maxPerUser = Number.isFinite(configuredMax)
					? Math.max(limits.minimum, Math.min(limits.maximum, Math.floor(configuredMax)))
					: limits.default;

				const activeCount = await ReminderModel.countDocuments({
					guildId: interaction.guildId,
					userId: interaction.user.id,
					notified: false,
				});

				if (activeCount >= maxPerUser) {
					return interaction.reply({
						content: `You already have ${activeCount} pending reminders (max ${maxPerUser}).`,
						ephemeral: true,
					});
				}

				const reminder = await ReminderModel.create({
					guildId: interaction.guildId,
					userId: interaction.user.id,
					channelId: interaction.channelId,
					message,
					remindAt,
				});

				return interaction.reply({
					content: `Reminder set for <t:${Math.floor(remindAt.getTime() / 1000)}:R> (id: \`${reminder._id}\`).`,
					ephemeral: true,
				});
			}

			if (subcommand === "list") {
				const query = {
					guildId: interaction.guildId,
					userId: interaction.user.id,
					notified: false,
				};
				const count = await ReminderModel.countDocuments(query);

				if (count === 0) {
					return interaction.reply({ content: "You have no pending reminders.", ephemeral: true });
				}
				const pages = Math.ceil(count / 5);
				const page = interaction.options.getInteger("page") ?? 1;
				if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
					return interaction.reply({ content: `Choose a page between 1 and ${pages}.`, ephemeral: true });
				}
				const reminders = await ReminderModel.find(query).sort({ remindAt: 1, _id: 1 }).skip((page - 1) * 5).limit(5).lean();
				if (reminders.length === 0) {
					return interaction.reply({ content: "This page is now empty. Run /remind list again.", ephemeral: true });
				}
				const lines = reminders.map((r) => {
					const text = String(r.message).replace(/\s+/g, " ");
					const preview = text.length > 250 ? `${text.slice(0, 247)}...` : text;
					return `\`${r._id}\` - <t:${Math.floor(new Date(r.remindAt).getTime() / 1000)}:R> - ${preview}`;
				});

				return interaction.reply({
					content: `${lines.join("\n")}\n\nPage ${page}/${pages} - ${count} pending reminder(s). Long messages are shortened. Use /remind list page:<number>.`,
					allowedMentions: { parse: [] },
					ephemeral: true,
				});
			}

			if (subcommand === "cancel") {
				const id = interaction.options.getString("id");
				if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
					return interaction.reply({ content: "Invalid reminder ID. Use an ID from /remind list.", ephemeral: true });
				}

				const result = await ReminderModel.deleteOne({
					_id: id,
					guildId: interaction.guildId,
					userId: interaction.user.id,
				});

				if (!result || result.deletedCount === 0) {
					return interaction.reply({ content: "No matching reminder found.", ephemeral: true });
				}

				return interaction.reply({ content: "Reminder cancelled.", ephemeral: true });
			}
		},
	};
}

module.exports = { createRemindCommand };
