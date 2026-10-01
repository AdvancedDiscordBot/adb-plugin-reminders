// Schema factory. Compiled into a namespaced model by index.js via
// ctx.defineModel("reminder", schema) -> collection "plugin_adb-plugin-reminders_reminder".

const { Schema } = require("mongoose");

const schema = new Schema({
	guildId: { type: String, required: true, index: true },
	userId: { type: String, required: true, index: true },
	channelId: { type: String, required: true },
	message: { type: String, required: true, maxlength: 1000 },
	remindAt: { type: Date, required: true, index: true },
	notified: { type: Boolean, default: false },
	nextAttemptAt: { type: Date, default: null },
	attempts: { type: Number, default: 0 },
	createdAt: { type: Date, default: Date.now },
});

schema.index({ notified: 1, remindAt: 1, nextAttemptAt: 1 });
module.exports = schema;
