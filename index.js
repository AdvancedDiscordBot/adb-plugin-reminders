const cron = require("node-cron");

const { createRemindCommand } = require("./commands/remind");
const reminderSchema = require("./models/reminder");

// NOTE: ctx.scheduler is the bot's internal TaskScheduler instance and does
// NOT expose a generic .schedule(name, cron, fn) method, despite what some
// ADB docs imply. Plugins that need their own periodic job bring their own
// node-cron dependency (same as ADB core does internally).

async function load(ctx) {
	const ReminderModel = ctx.defineModel("reminder", reminderSchema);

	// configSchema.maxPerUser is per-guild (via ctx.db.getPluginConfig) in the
	// real ADB config model. This plugin uses one global default to keep the
	// example simple — read per-guild overrides inside the command if needed.
	const DEFAULT_MAX_PER_USER = 25;

	ctx.registerCommand(createRemindCommand(ReminderModel, { maxPerUser: DEFAULT_MAX_PER_USER }));

	const task = cron.schedule("* * * * *", async () => {
		await deliverDueReminders(ctx, ReminderModel);
	});

	ctx.hooks.on("onPluginUnload", async ({ pluginName }) => {
		if (pluginName === "adb-plugin-reminders") {
			task.stop();
		}
	});

	ctx.logger.info("Reminders plugin loaded");
}

async function deliverDueReminders(ctx, ReminderModel) {
	const due = await ReminderModel.find({
		remindAt: { $lte: new Date() },
		notified: false,
	}).limit(100);

	for (const reminder of due) {
		try {
			const embedContent = `⏰ Reminder: ${reminder.message}`;
			const user = await ctx.client.users.fetch(reminder.userId).catch(() => null);

			let delivered = false;
			if (user) {
				delivered = await user
					.send(embedContent)
					.then(() => true)
					.catch(() => false);
			}

			if (!delivered) {
				const channel = await ctx.client.channels.fetch(reminder.channelId).catch(() => null);
				if (channel?.isTextBased()) {
					await channel.send(`<@${reminder.userId}> ${embedContent}`).catch(() => {});
				}
			}

			reminder.notified = true;
			await reminder.save();
		} catch (error) {
			ctx.logger.error(`Failed to deliver reminder ${reminder._id}`, error);
		}
	}
}

module.exports = { load };
