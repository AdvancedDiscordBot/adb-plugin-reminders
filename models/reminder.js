// Schema factory. Compiled into a namespaced model by index.js via
// ctx.defineModel("reminder", schema) -> collection "plugin_adb-plugin-reminders_reminder".

const { Schema } = require("mongoose");

module.exports = new Schema({
	guildId: { type: String, required: true, index: true },
	userId: { type: String, required: true, index: true },
	channelId: { type: String, required: true },
	message: { type: String, required: true },
	remindAt: { type: Date, required: true, index: true },
	notified: { type: Boolean, default: false },
	createdAt: { type: Date, default: Date.now },
});
