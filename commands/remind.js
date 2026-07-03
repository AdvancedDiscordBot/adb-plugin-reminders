const { parseDuration } = require("../lib/parseDuration");

// Factory takes the compiled Reminder model + a maxPerUser limit, returns a
// command module in the shape PluginManager expects: { data, execute }.
function createRemindCommand(ReminderModel, { maxPerUser = 25 } = {}) {
	return {
		data: {
			name: "remind",
			description: "Manage personal reminders",
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
						},
					],
				},
				{
					name: "list",
					description: "List your pending reminders",
					type: 1,
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
			const subcommand = interaction.options.getSubcommand();

			if (subcommand === "set") {
				const timeInput = interaction.options.getString("time");
				const message = interaction.options.getString("message");
				const ms = parseDuration(timeInput);

				if (!ms) {
					return interaction.reply({
						content: "Invalid time format. Use e.g. `30s`, `10m`, `2h`, `1d`.",
						ephemeral: true,
					});
				}

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

				const remindAt = new Date(Date.now() + ms);

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
				const reminders = await ReminderModel.find({
					guildId: interaction.guildId,
					userId: interaction.user.id,
					notified: false,
				}).sort({ remindAt: 1 });

				if (reminders.length === 0) {
					return interaction.reply({ content: "You have no pending reminders.", ephemeral: true });
				}

				const lines = reminders.map(
					(r) => `\`${r._id}\` — <t:${Math.floor(r.remindAt.getTime() / 1000)}:R> — ${r.message}`,
				);

				return interaction.reply({ content: lines.join("\n"), ephemeral: true });
			}

			if (subcommand === "cancel") {
				const id = interaction.options.getString("id");

				const result = await ReminderModel.deleteOne({
					_id: id,
					guildId: interaction.guildId,
					userId: interaction.user.id,
				}).catch(() => null);

				if (!result || result.deletedCount === 0) {
					return interaction.reply({ content: "No matching reminder found.", ephemeral: true });
				}

				return interaction.reply({ content: "Reminder cancelled.", ephemeral: true });
			}
		},
	};
}

module.exports = { createRemindCommand };
