const { createRemindCommand } = require("./commands/remind");
const reminderSchema = require("./models/reminder");

// ISOLATION NOTES (see Advanced-Discord-Bot/CREATE-PLUGIN.md):
//   - No node-cron: it does not load inside a worker. Recurring work goes
//     through ctx.scheduler.schedule(expression, cb, name) — Core runs the cron.
//   - No ctx.client: delivery uses ctx.discord.sendDM (with a channel fallback
//     via ctx.discord.sendToChannel).
//   - Models route through RPC: find() returns a plain ARRAY (no .limit()), and
//     a fetched doc is persisted with ReminderModel.save(doc, changes), not
//     doc.save().

const CHECK_EXPRESSION = "* * * * *"; // every minute
const TASK_NAME = "deliver-due-reminders";

async function load(ctx) {
	const ReminderModel = ctx.defineModel("reminder", reminderSchema);

	// configSchema.maxPerUser is per-guild in the real config model; this plugin
	// uses one global default to keep the example simple.
	const DEFAULT_MAX_PER_USER = 25;

	ctx.registerCommand(createRemindCommand(ReminderModel, { maxPerUser: DEFAULT_MAX_PER_USER }));

	await ctx.scheduler.schedule(
		CHECK_EXPRESSION,
		async () => {
			await deliverDueReminders(ctx, ReminderModel);
		},
		TASK_NAME,
	);

	ctx.logger.info("Reminders plugin loaded");
}

async function deliverDueReminders(ctx, ReminderModel) {
	// No .limit() over RPC — fetch pending, cap in memory.
	const pending = await ReminderModel.find({ notified: false });
	const now = Date.now();
	const due = pending.filter((r) => new Date(r.remindAt).getTime() <= now).slice(0, 100);

	for (const reminder of due) {
		try {
			const content = `⏰ Reminder: ${reminder.message}`;

			// Try a DM first; fall back to the origin channel.
			let delivered = false;
			try {
				await ctx.discord.sendDM(reminder.userId, { content });
				delivered = true;
			} catch {
				delivered = false;
			}

			if (!delivered && reminder.channelId) {
				try {
					await ctx.discord.sendToChannel(reminder.channelId, {
						content: `<@${reminder.userId}> ${content}`,
					});
				} catch {
					// Give up on delivery; still mark notified below so we don't
					// spin on this reminder forever.
				}
			}

			await ReminderModel.save(reminder, { notified: true });
		} catch (error) {
			ctx.logger.error(`Failed to deliver reminder ${reminder._id}`, error);
		}
	}
}

module.exports = { load, deliverDueReminders };
