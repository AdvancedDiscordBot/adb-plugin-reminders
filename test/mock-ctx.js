// Same shape as the template's mock-ctx.js, trimmed to what this plugin uses.
// Real ctx.defineModel returns a compiled mongoose model; here we hand back
// a fake in-memory model so command logic is testable without MongoDB.

function createInMemoryModel() {
	let seq = 1;
	const rows = new Map();

	return {
		async create(doc) {
			const _id = String(seq++);
			const row = {
				notified: false,
				...doc,
				_id,
				save: async function () { rows.set(_id, this); },
			};
			rows.set(_id, row);
			return row;
		},
		find(query) {
			const results = [...rows.values()].filter((row) => matches(row, query));
			return {
				sort: (spec) => {
					const [key, dir] = Object.entries(spec)[0];
					results.sort((a, b) => (a[key] > b[key] ? 1 : -1) * dir);
					return Promise.resolve(results);
				},
				limit: (n) => Promise.resolve(results.slice(0, n)),
				then: (resolve, reject) => Promise.resolve(results).then(resolve, reject),
			};
		},
		async countDocuments(query) {
			return [...rows.values()].filter((row) => matches(row, query)).length;
		},
		async deleteOne(query) {
			const match = [...rows.entries()].find(([, row]) => matches(row, query));
			if (!match) return { deletedCount: 0 };
			rows.delete(match[0]);
			return { deletedCount: 1 };
		},
		_rows: rows,
	};
}

function matches(row, query) {
	return Object.entries(query).every(([key, value]) => {
		if (value && typeof value === "object" && "$lte" in value) {
			return row[key] <= value.$lte;
		}
		return row[key] === value;
	});
}

function createMockCtx({ pluginName = "adb-plugin-reminders" } = {}) {
	const commands = new Map();
	const hookHandlers = new Map();

	const logger = {
		info: (...args) => console.log(`[${pluginName}]`, ...args),
		warn: (...args) => console.warn(`[${pluginName}]`, ...args),
		error: (...args) => console.error(`[${pluginName}]`, ...args),
	};

	const models = new Map();

	const ctx = {
		client: {
			commands,
			users: { fetch: async () => null },
			channels: { fetch: async () => null },
		},
		db: null,
		scheduler: null,
		commands,
		registerCommand(command) {
			commands.set(command.data.name, command);
		},
		defineModel(modelName) {
			if (!models.has(modelName)) models.set(modelName, createInMemoryModel());
			return models.get(modelName);
		},
		hooks: {
			on() {},
			async emitHook() {},
		},
		config: { env: process.env },
		logger,
	};

	return { ctx, commands, models };
}

module.exports = { createMockCtx };
