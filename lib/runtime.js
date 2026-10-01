// The shipped direct and worker contexts have different scheduling/delivery
// surfaces. Keep that compatibility boundary here; model CRUD is shared.
function createRuntime(ctx) {
	if (ctx.client === null) {
		return {
			schedule: (name, expression, callback) => ctx.scheduler.schedule(expression, callback, name),
			sendDM: (userId, payload) => ctx.discord.sendDM(userId, payload),
			sendToChannel: (channelId, payload) => ctx.discord.sendToChannel(channelId, payload),
		};
	}

	return {
		schedule: (name, expression, callback) => ctx.scheduler.schedule(`adb-plugin-reminders:${name}`, expression, callback),
		async sendDM(userId, payload) {
			const user = await ctx.client.users.fetch(userId);
			return user.send(payload);
		},
		async sendToChannel(channelId, payload) {
			const channel = await ctx.client.channels.fetch(channelId);
			if (!channel?.isTextBased() || typeof channel.send !== "function") throw new Error("Reminder channel is unavailable");
			return channel.send(payload);
		},
	};
}

module.exports = { createRuntime };
