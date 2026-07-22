// Run with: npm test  (or) node test/local-harness.js
//
// Offline smoke test for adb-plugin-reminders against the ISOLATED mock ctx
// (test/mock-ctx.js) — null client, RPC-style models, ctx.scheduler,
// ctx.discord. No running bot / no Mongo / no node-cron.

const assert = require("node:assert");
const { load } = require("../index.js");
const { createMockCtx } = require("./mock-ctx");
const { parseDuration } = require("../lib/parseDuration");

function fakeInteraction({ subcommand, strings = {} } = {}) {
	const replies = [];
	return {
		guildId: "guild-1",
		channelId: "channel-1",
		user: { id: "user-1" },
		options: {
			getSubcommand: () => subcommand,
			getString: (name) => strings[name] ?? null,
		},
		reply: async (payload) => {
			replies.push(payload);
			return payload;
		},
		replies,
	};
}

async function main() {
	assert.strictEqual(parseDuration("10m"), 10 * 60 * 1000);
	assert.strictEqual(parseDuration("garbage"), null);

	const { ctx, registeredCommands, models, sent, scheduled, runTask } = createMockCtx({
		pluginName: "adb-plugin-reminders",
	});
	await load(ctx);

	assert.ok(registeredCommands.has("remind"), "expected /remind to be registered");
	const remind = registeredCommands.get("remind");

	// The plugin must register its delivery task via ctx.scheduler (NOT node-cron).
	assert.ok(scheduled.has("deliver-due-reminders"), "expected scheduler task to be registered");

	const setInteraction = fakeInteraction({ subcommand: "set", strings: { time: "10m", message: "check the oven" } });
	await remind.execute(setInteraction);
	assert.match(setInteraction.replies[0].content, /Reminder set for/);

	const listInteraction = fakeInteraction({ subcommand: "list" });
	await remind.execute(listInteraction);
	assert.match(listInteraction.replies[0].content, /check the oven/);

	const badTimeInteraction = fakeInteraction({ subcommand: "set", strings: { time: "whenever", message: "x" } });
	await remind.execute(badTimeInteraction);
	assert.match(badTimeInteraction.replies[0].content, /Invalid time format/);

	// --- Delivery: force a due reminder, fire the scheduled task, assert it went
	// out via ctx.discord and got marked notified. ---
	const model = models.get("plugin_adb-plugin-reminders_reminder");
	// backdate the pending reminder so it's due
	model._store.forEach((r) => {
		r.remindAt = new Date(Date.now() - 1000);
	});
	await runTask("deliver-due-reminders");
	assert.strictEqual(sent.length, 1, "expected one delivery");
	assert.strictEqual(sent[0].kind, "dm", "reminder delivered via DM");
	assert.match(sent[0].payload.content, /check the oven/);
	const remaining = await model.find({ notified: false });
	assert.strictEqual(remaining.length, 0, "delivered reminder marked notified");

	// cancel path
	const setAgain = fakeInteraction({ subcommand: "set", strings: { time: "5m", message: "call mom" } });
	await remind.execute(setAgain);
	const id = setAgain.replies[0].content.match(/id: `([^`]+)`/)[1];
	const cancel = fakeInteraction({ subcommand: "cancel", strings: { id } });
	await remind.execute(cancel);
	assert.match(cancel.replies[0].content, /Reminder cancelled/);

	console.log("OK: all local-harness checks passed");
}

main().catch((error) => {
	console.error("Local harness failed:", error);
	process.exit(1);
});
