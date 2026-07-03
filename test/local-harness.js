// Run with: npm test  (or) node test/local-harness.js

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

	const { ctx, commands } = createMockCtx();
	await load(ctx);

	assert.ok(commands.has("remind"), "expected /remind to be registered");
	const remind = commands.get("remind");

	const setInteraction = fakeInteraction({ subcommand: "set", strings: { time: "10m", message: "check the oven" } });
	await remind.execute(setInteraction);
	assert.match(setInteraction.replies[0].content, /Reminder set for/);

	const listInteraction = fakeInteraction({ subcommand: "list" });
	await remind.execute(listInteraction);
	assert.match(listInteraction.replies[0].content, /check the oven/);

	const badTimeInteraction = fakeInteraction({ subcommand: "set", strings: { time: "whenever", message: "x" } });
	await remind.execute(badTimeInteraction);
	assert.match(badTimeInteraction.replies[0].content, /Invalid time format/);

	console.log("OK: all local-harness checks passed");
	process.exit(0); // node-cron in index.js keeps the event loop alive otherwise
}

main().catch((error) => {
	console.error("Local harness failed:", error);
	process.exit(1);
});
