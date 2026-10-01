"use strict";

const assert = require("node:assert/strict");
const { load } = require("../index");
const { createMockCtx, createInteraction, newId } = require("./mock-ctx");
const { parseDuration } = require("../lib/parseDuration");
const manifest = require("../plugin.json");

let passed = 0;
let failed = 0;
let now;
async function test(name, run) {
	try {
		await run();
		passed++;
		console.log(`PASS ${name}`);
	} catch (error) {
		failed++;
		console.error(`FAIL ${name}: ${error.stack}`);
	}
}

async function fixture(mode) {
	now = Date.UTC(2026, 8, 19, 12);
	const mock = createMockCtx({ mode });
	mock.pluginConfigs.set(`guild-1:${manifest.name}`, { guildId: "guild-1", pluginName: manifest.name, enabled: true, data: {} });
	await load(mock.ctx);
	const command = mock.registeredCommands.get("remind");
	assert.ok(command, "registered /remind handler");
	const model = mock.models.get(`plugin_${manifest.name}_reminder`);
	return {
		...mock, command, model,
		tick: () => mock.runTask([...mock.scheduled.keys()].pop()),
		async execute(sub, values, actor) {
			const interaction = createInteraction(sub, values, actor);
			await command.execute(interaction, mock.client); // Never pass ctx as client.
			assert.equal(interaction.replies.length, 1);
			assert.equal(interaction.replies[0].ephemeral, true);
			return interaction.replies[0];
		},
		seed: (extra = {}) => model.create({ guildId: "guild-1", userId: "user-1", channelId: "channel-1", message: "check the oven", remindAt: new Date(now - 1000), ...extra }),
	};
}

async function main() {
	const originalNow = Date.now;
	Date.now = () => now;
	try {
		await test("duration parser rejects overflow as well as invalid input", async () => {
			assert.equal(parseDuration(" 2H "), 7200000);
			assert.equal(parseDuration("30s"), 30000);
			for (const input of [null, "", "0m", "-1h", "garbage", "1.5h", `${"9".repeat(300)}d`]) assert.equal(parseDuration(input), null);
			assert.equal(parseDuration("9999999999999999d"), null);
		});

		for (const mode of ["worker", "direct"]) {
			await test(`${mode}: registers the correct scheduler signature and supports set/list/cancel`, async () => {
				const f = await fixture(mode);
				assert.equal(f.scheduleCalls.length, 1);
				assert.equal(f.scheduleCalls[0].expression, "* * * * *");
				if (mode === "direct") assert.match(f.scheduleCalls[0].name, /adb-plugin-reminders/);
				const added = await f.execute("set", { time: "10m", message: "check the oven" });
				assert.match(added.content, /Reminder set/);
				const id = added.content.match(/id: `([^`]+)`/)[1];
				assert.match(id, /^[a-f0-9]{24}$/);
				assert.equal(new Date(f.model._store[0].remindAt).getTime(), now + 600000);
				assert.match((await f.execute("list")).content, /check the oven/);
				assert.match((await f.execute("cancel", { id }, { userId: "other-user" })).content, /No matching/);
				assert.match((await f.execute("cancel", { id }, { guildId: "other-guild" })).content, /No matching/);
				assert.match((await f.execute("cancel", { id })).content, /cancelled/);
				assert.match((await f.execute("list")).content, /no pending/i);
			});

			await test(`${mode}: uses current per-guild maxPerUser, not a load-time constant`, async () => {
				const f = await fixture(mode);
				await f.ctx.db.updatePluginConfig("guild-1", manifest.name, { maxPerUser: 1 });
				await f.seed();
				await f.seed({ notified: true });
				assert.match((await f.execute("set", { time: "1m", message: "blocked" })).content, /max 1\b/);
				assert.match((await f.execute("set", { time: "1m", message: "other guild" }, { guildId: "guild-2" })).content, /Reminder set/);
				assert.match((await f.execute("set", { time: "1m", message: "other user" }, { userId: "user-2" })).content, /Reminder set/);
				await f.ctx.db.updatePluginConfig("guild-1", manifest.name, { maxPerUser: 2 });
				assert.match((await f.execute("set", { time: "1m", message: "new limit" })).content, /Reminder set/);
			});

			await test(`${mode}: keeps default quota and rejects malformed command input before storage`, async () => {
				const f = await fixture(mode);
				for (const time of ["whenever", "100000000d"]) {
					assert.match((await f.execute("set", { time, message: "x" })).content, /Invalid time/);
				}
				for (const message of [null, "", "   ", "x".repeat(1001)]) {
					assert.match((await f.execute("set", { time: "1m", message })).content, /message|long/i);
				}
				for (const id of ["nope", "123", "f".repeat(23), "z".repeat(24), null]) {
					assert.match((await f.execute("cancel", { id })).content, /ID|matching/i);
				}
				assert.equal(f.model._calls.length, 0, "invalid inputs never reach the model");
				assert.match((await f.execute("cancel", { id: newId() })).content, /No matching/);
				for (let i = 0; i < 25; i++) await f.seed();
				assert.match((await f.execute("set", { time: "1m", message: "full" })).content, /max 25\b/);
			});

			await test(`${mode}: rejects DM command use gracefully`, async () => {
				const f = await fixture(mode);
				for (const sub of ["set", "list", "cancel"]) {
					assert.match((await f.execute(sub, { time: "1m", message: "x", id: newId() }, { guildId: null })).content, /server/i);
				}
				assert.equal(f.model._calls.length, 0);
			});

			await test(`${mode}: paginates long reminders with every ID reachable and content under 2000`, async () => {
				const f = await fixture(mode);
				const ids = [];
				for (let i = 0; i < 12; i++) ids.push(String((await f.seed({ message: `${i} `.padEnd(1000, "x"), remindAt: new Date(now + i * 1000) }))._id));
				const seen = [];
				for (let page = 1; page <= 3; page++) {
					const reply = await f.execute("list", { page });
					assert.match(reply.content, new RegExp(`Page ${page}/3`, "i"));
					for (const id of ids) if (reply.content.includes(id)) seen.push(id);
				}
				assert.deepEqual(seen, ids);
				for (const call of f.model._calls.filter((call) => call.method === "find")) assert.ok(call.options.limit <= 5 && call.returned <= 5);
				assert.match((await f.execute("list", { page: 99 })).content, /page/i);
			});

			await test(`${mode}: filters due dates in the DB and delivers at most 100 rows per tick`, async () => {
				const f = await fixture(mode);
				for (let i = 0; i < 110; i++) await f.seed({ remindAt: new Date(now + 60000) });
				for (let i = 0; i < 105; i++) await f.seed({ remindAt: new Date(now - (105 - i) * 1000) });
				await f.seed({ notified: true });
				await f.tick();
				assert.equal(f.sent.length, 100);
				assert.equal(f.sent[0].kind, "dm");
				const call = f.model._calls.find((entry) => entry.method === "find");
				assert.equal(new Date(call.query.remindAt.$lte).getTime(), now);
				assert.equal(call.options.limit, 100);
				assert.equal(call.returned, 100);
				assert.equal(call.options.sort.remindAt, 1);
				await f.tick();
				assert.equal(f.sent.length, 105);
				assert.equal(await f.model.countDocuments({ notified: false }), 110);
				assert.ok(!f.model._calls.some((entry) => entry.method === "save"), "no worker-only Model.save");
			});

			await test(`${mode}: a concurrently emptied list page replies gracefully`, async () => {
				const f = await fixture(mode);
				await f.seed();
				const find = f.model.find;
				f.model.find = (query) => { f.model._store.length = 0; return find(query); };
				assert.match((await f.execute("list")).content, /page.*empty/i);
			});

			await test(`${mode}: legacy rows need no retry-field backfill and oversized messages stay sendable`, async () => {
				const f = await fixture(mode);
				await f.seed();
				const row = f.model._store[0];
				delete row.nextAttemptAt;
				delete row.attempts;
				row.message = "legacy message ".repeat(500);
				await f.tick();
				assert.equal(f.sent.length, 1);
				assert.match(f.sent[0].payload.content, /legacy message/);
				assert.ok(f.sent[0].payload.content.length <= 2000);
				assert.equal(row.notified, true);
				assert.equal(row.attempts, 1);
			});

			await test(`${mode}: channel fallback succeeds without allowing user-supplied mentions`, async () => {
				const f = await fixture(mode);
				f.sendHandlers.dm = async () => { throw new Error("DMs closed"); };
				await f.seed({ message: "@everyone @here <@&12345> <@12345> test" });
				await f.tick();
				assert.equal(f.attempts.length, 2);
				assert.equal(f.sent.length, 1);
				assert.equal(f.sent[0].kind, "channel");
				assert.match(f.sent[0].payload.content, /^<@user-1>/);
				assert.doesNotMatch(f.sent[0].payload.content, /@everyone|@here|<@&?12345>/);
				assert.equal(f.model._store[0].notified, true);
				await f.tick();
				assert.equal(f.sent.length, 1);
			});

			await test(`${mode}: failed deliveries remain pending with persistent, capped exponential backoff`, async () => {
				const f = await fixture(mode);
				f.sendHandlers.dm = f.sendHandlers.channel = async () => { throw new Error("unavailable"); };
				await f.seed();
				await f.tick();
				const row = f.model._store[0];
				assert.equal(row.notified, false);
				assert.equal(row.attempts, 1);
				assert.equal(new Date(row.nextAttemptAt).getTime() - now, 300000);
				await load(f.ctx); // Re-register with fresh in-memory delivery state.
				await f.tick();
				assert.equal(f.attempts.length, 2, "no sends before the stored retry time, even after reload");
				for (const delay of [600000, 1200000, 2400000, 3600000, 3600000]) {
					now = new Date(row.nextAttemptAt).getTime();
					await f.tick();
					assert.equal(new Date(row.nextAttemptAt).getTime() - now, delay);
					assert.equal(row.notified, false);
				}
				delete f.sendHandlers.dm;
				now = new Date(row.nextAttemptAt).getTime();
				await f.tick();
				assert.equal(row.notified, true);
				assert.equal(f.sent.length, 1);
			});

			await test(`${mode}: missing/disabled guilds are deferred, never delivered or marked notified`, async () => {
				const f = await fixture(mode);
				await f.seed({ guildId: "disabled" });
				await f.seed({ guildId: "missing" });
				await f.seed();
				f.pluginConfigs.set(`disabled:${manifest.name}`, { enabled: false, data: { enabled: true } });
				await f.tick();
				assert.equal(f.sent.length, 1);
				assert.deepEqual(f.model._store.map((row) => row.notified), [false, false, true]);
				assert.equal(f.model._store[0].attempts, 0);
				f.pluginConfigs.get(`disabled:${manifest.name}`).enabled = true;
				now += 300000;
				await f.tick();
				assert.equal(f.sent.length, 2);
			});

			await test(`${mode}: disabled rows cannot starve another guild behind the batch cap`, async () => {
				const f = await fixture(mode);
				for (let i = 0; i < 101; i++) await f.seed({ guildId: "disabled", remindAt: new Date(now - 60000) });
				await f.seed();
				await f.tick();
				await f.tick();
				assert.equal(f.sent.length, 1);
				assert.equal(f.model._store.filter((row) => row.notified).length, 1);
			});

			await test(`${mode}: rechecks enable state between reminders and before fallback`, async () => {
				const f = await fixture(mode);
				await f.seed();
				await f.seed();
				f.sendHandlers.dm = async () => { f.pluginConfigs.get(`guild-1:${manifest.name}`).enabled = false; };
				await f.tick();
				assert.equal(f.sent.length, 1);
				assert.equal(f.model._store[1].notified, false);
				f.pluginConfigs.get(`guild-1:${manifest.name}`).enabled = true;
				now += 300000;
				f.sendHandlers.dm = async () => {
					f.pluginConfigs.get(`guild-1:${manifest.name}`).enabled = false;
					throw new Error("disabled during failed DM");
				};
				await f.tick();
				assert.equal(f.sent.length, 1, "no channel fallback after disable");
			});

			await test(`${mode}: overlapping ticks share an in-flight guard and only notify after send resolves`, async () => {
				const f = await fixture(mode);
				await f.seed();
				let enter;
				let release;
				const entered = new Promise((resolve) => { enter = resolve; });
				const blocked = new Promise((resolve) => { release = resolve; });
				f.sendHandlers.dm = async () => { enter(); await blocked; };
				const first = f.tick();
				await entered;
				const second = f.tick();
				try {
					await new Promise(setImmediate);
					assert.equal(f.model._store[0].notified, false);
					assert.equal(f.attempts.length, 1);
					assert.equal(f.model._calls.filter((call) => call.method === "find").length, 1);
				} finally {
					release();
					await Promise.all([first, second]);
				}
				assert.equal(f.model._store[0].notified, true);
			});

			await test(`${mode}: separate runners conditionally claim a due row before sending`, async () => {
				const f = await fixture(mode);
				await f.seed();
				const first = [...f.scheduled.values()][0];
				await load(f.ctx);
				await Promise.all([first(), f.tick()]);
				assert.equal(f.sent.length, 1);
			});

			for (const kind of ["dm", "channel"]) await test(`${mode}: ${kind} success followed by DB failure retries only the acknowledgement`, async () => {
				const f = await fixture(mode);
				await f.seed();
				await f.seed({ message: "second" });
				if (kind === "channel") f.sendHandlers.dm = async () => { throw new Error("DMs closed"); };
				const update = f.model.updateOne;
				f.model.updateOne = async (query, change) => {
					if (change.$set?.notified === true) throw new Error("DB write unavailable");
					return update(query, change);
				};
				await f.tick();
				assert.equal(f.sent.length, 1, "stop the batch when a sent message cannot be acknowledged");
				assert.equal(f.model._store[0].notified, false);
				now += 3600000;
				await f.tick();
				assert.equal(f.sent.length, 1, "successful sends are not replayed");
				f.model.updateOne = update;
				await f.tick();
				assert.equal(f.sent.length, 2, "acknowledge first, then send second");
				assert.ok(f.model._store.every((row) => row.notified));
			});

			await test(`${mode}: DB/config failures fail closed and release the tick guard`, async () => {
				const f = await fixture(mode);
				await f.seed();
				const getConfig = f.ctx.db.getPluginConfig;
				f.ctx.db.getPluginConfig = async () => { throw new Error("config offline"); };
				await f.tick();
				assert.equal(f.sent.length, 0);
				f.ctx.db.getPluginConfig = getConfig;
				const find = f.model.find;
				f.model.find = () => { throw new Error("DB read offline"); };
				await f.tick();
				f.model.find = find;
				const update = f.model.updateOne;
				f.model.updateOne = async () => { throw new Error("DB claim offline"); };
				await f.tick();
				assert.equal(f.sent.length, 0);
				f.model.updateOne = update;
				await f.tick();
				assert.equal(f.sent.length, 1);
				assert.ok(f.logs.some((log) => log.level === "error"));
			});
		}

		await test("direct: unload removes the scheduled job and makes its retained callback inert", async () => {
			const f = await fixture("direct");
			await f.seed();
			const callback = [...f.scheduled.values()][0];
			await f.hooks.emitHook("onPluginUnload", { pluginName: "another-plugin" });
			assert.equal(f.scheduled.size, 1);
			await f.hooks.emitHook("onPluginUnload", { pluginName: manifest.name });
			await callback();
			assert.equal(f.sent.length, 0, "an unloaded plugin must not deliver reminders");
			assert.equal(f.scheduled.size, 0);
			assert.equal(f.model._store[0].notified, false);
		});

		await test("direct: unload during a send acknowledges it but stops the rest of the batch", async () => {
			const f = await fixture("direct");
			await f.seed();
			await f.seed();
			f.sendHandlers.dm = () => f.hooks.emitHook("onPluginUnload", { pluginName: manifest.name });
			await f.tick();
			assert.equal(f.sent.length, 1);
			assert.deepEqual(f.model._store.map((row) => row.notified), [true, false]);
			assert.equal(f.scheduled.size, 0);
		});

		await test("direct: unload during a config read prevents the pending send", async () => {
			const f = await fixture("direct");
			await f.seed();
			const getConfig = f.ctx.db.getPluginConfig;
			f.ctx.db.getPluginConfig = async (...args) => {
				await f.hooks.emitHook("onPluginUnload", { pluginName: manifest.name });
				return getConfig(...args);
			};
			await f.tick();
			assert.equal(f.sent.length, 0);
			assert.equal(f.model._store[0].notified, false);
		});

		await test("worker: cron and storage capabilities remain required; no raw-client opt-out", async () => {
			assert.equal(manifest.isolation, true);
			assert.equal(manifest.requiresRestart, true, "Core must recompile the schema to persist retry fields");
			assert.ok(!JSON.stringify(manifest.capabilities).includes("raw-client"));
			const mock = createMockCtx({ capabilities: { storage: ["own-collection"] } });
			await assert.rejects(load(mock.ctx), /scheduler:cron/);
		});
	} finally {
		Date.now = originalNow;
	}
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
