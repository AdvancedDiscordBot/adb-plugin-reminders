const { createRemindCommand } = require("./commands/remind");
const reminderSchema = require("./models/reminder");
const { createRuntime } = require("./lib/runtime");
const { name: PLUGIN_NAME } = require("./plugin.json");

const CHECK_EXPRESSION = "* * * * *"; // every minute
const TASK_NAME = "deliver-due-reminders";
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

async function load(ctx) {
	const ReminderModel = ctx.defineModel("reminder", reminderSchema);
	const state = { running: false, deliveredId: null, stopped: false };

	await ctx.registerCommand(createRemindCommand(ReminderModel, ctx.db));
	await createRuntime(ctx).schedule(
		TASK_NAME,
		CHECK_EXPRESSION,
		() => deliverDueReminders(ctx, ReminderModel, state),
	);
	// Core tears down worker cron jobs; direct-mode tasks use the shared scheduler.
	if (ctx.client !== null) ctx.hooks.on("onPluginUnload", ({ pluginName }) => {
		if (pluginName !== PLUGIN_NAME) return;
		state.stopped = true;
		ctx.scheduler.unschedule(`${PLUGIN_NAME}:${TASK_NAME}`);
	});

	ctx.logger.info("Reminders plugin loaded");
}

async function deliverDueReminders(ctx, ReminderModel, state = { running: false, deliveredId: null, stopped: false }) {
	if (state.running || state.stopped) return;
	state.running = true;
	const runtime = createRuntime(ctx);
	const acknowledge = async () => {
		if (!state.deliveredId) return;
		const result = await ReminderModel.updateOne(
			{ _id: state.deliveredId, notified: false },
			{ $set: { notified: true, nextAttemptAt: null } },
		);
		if (!result.acknowledged) throw new Error("Reminder acknowledgement was not persisted");
		state.deliveredId = null;
	};

	try {
		// A successful Discord send must not be replayed just because its DB write
		// failed. Pause new deliveries until this acknowledgement is persisted.
		await acknowledge();
		const now = new Date(Date.now());
		const eligible = {
			notified: false,
			remindAt: { $lte: now },
			$or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
		};
		const due = await ReminderModel.find(eligible).sort({ remindAt: 1, _id: 1 }).limit(100).lean();

		for (const reminder of due) {
			if (state.stopped) return;
			try {
				const filter = { ...eligible, _id: reminder._id };
				const config = await ctx.db.getPluginConfig(reminder.guildId, PLUGIN_NAME);
				if (state.stopped) return;
				if (config?.enabled !== true) {
					// Move disabled rows out of the next batch without consuming an
					// attempt, so they cannot starve enabled guilds behind the cap.
					await ReminderModel.updateOne(filter, { $set: { nextAttemptAt: new Date(Date.now() + RETRY_BASE_MS) } });
					continue;
				}

				const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(reminder.attempts || 0, 4), RETRY_MAX_MS);
				// Conditional claim also excludes a second runner during reload. The
				// retry time is persisted BEFORE Discord so a crash cannot hot-loop.
				const claimed = await ReminderModel.updateOne(filter, {
					$set: { nextAttemptAt: new Date(Date.now() + delay) },
					$inc: { attempts: 1 },
				});
				if (state.stopped) return;
				if (claimed.modifiedCount !== 1) continue;

				// Neutralize body mentions even on older shipped workers that omitted
				// allowedMentions; only the explicit fallback recipient may ping.
				const content = `⏰ Reminder: ${String(reminder.message).replace(/@/g, "@\u200b")}`.slice(0, 1900);
				try {
					await runtime.sendDM(reminder.userId, { content, allowedMentions: { parse: [] } });
				} catch (error) {
					if (!reminder.channelId) throw error;
					const currentConfig = await ctx.db.getPluginConfig(reminder.guildId, PLUGIN_NAME);
					if (state.stopped) return;
					if (currentConfig?.enabled !== true) continue;
					await runtime.sendToChannel(reminder.channelId, {
						content: `<@${reminder.userId}> ${content}`,
						allowedMentions: { parse: [], users: [reminder.userId] },
					});
				}

				state.deliveredId = String(reminder._id);
				await acknowledge();
			} catch (error) {
				ctx.logger.error(`Failed to deliver or acknowledge reminder ${reminder._id}`, error);
				if (state.deliveredId) return;
			}
		}
	} catch (error) {
		ctx.logger.error("Reminder delivery tick failed", error);
	} finally {
		state.running = false;
	}
}

module.exports = { load, deliverDueReminders };
