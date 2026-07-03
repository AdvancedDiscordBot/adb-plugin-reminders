# adb-plugin-reminders

Personal reminders for [Advanced Discord Bot](https://github.com/DeadIndian/Advanced-Discord-Bot).

`/remind set time:10m message:"check the oven"` — bot DMs you when it's due (falls back to the channel you set it in if DMs are closed).

## Commands

- `/remind set time:<10m|2h|1d|30s> message:<text>` — create a reminder
- `/remind list` — list your pending reminders in this server
- `/remind cancel id:<id>` — cancel one (id comes from `/remind list`)

## How it works

- Reminders are stored in Mongo via `ctx.defineModel("reminder", schema)` → collection `plugin_adb-plugin-reminders_reminder`.
- A `node-cron` job (`* * * * *`, i.e. every minute) checks for due, undelivered reminders and sends them.
- **Note**: this plugin bundles its own `node-cron` dependency rather than using `ctx.scheduler`. The real ADB `ctx.scheduler` is the bot's internal `TaskScheduler` and does not expose a generic `.schedule(name, cron, fn)` method — despite what `CREATE-PLUGIN.md` in the core repo implies. Bring your own cron for plugin-owned periodic jobs.

## Local testing (no bot, no Mongo required)

```bash
npm install
npm test
```

Runs `test/local-harness.js` against `test/mock-ctx.js`, a fake in-memory `ctx` — exercises `/remind set|list` and the duration parser directly.

## Testing inside a real bot

1. Clone/have a working copy of Advanced Discord Bot.
2. Either:
   - **Copy/symlink** this folder into that bot's `plugins/` directory:
     ```bash
     ln -s $(pwd) /path/to/Advanced-Discord-Bot/plugins/adb-plugin-reminders
     ```
   - **Or npm link** it so it's discovered the same way a real npm-installed plugin would be (via `node_modules/adb-plugin-*` scanning):
     ```bash
     npm link                                          # from this folder
     cd /path/to/Advanced-Discord-Bot
     npm link adb-plugin-reminders
     ```
3. Start the bot. Check logs for `Reminders plugin loaded`.
4. Run `npm run deploy` (in the bot repo) to register the new `/remind` slash command with Discord, since new commands need a deploy step even though plugin *logic* hot-reloads.
5. Try `/remind set time:30s message:"test"` in Discord and confirm delivery.

## Installing from npm

```bash
npm install adb-plugin-reminders
```

...into their bot's root `node_modules/`, and ADB's `PluginManager` will auto-discover it (any `node_modules/adb-plugin-*` folder with a `plugin.json` + entry file).

## Submitting to the ADB plugin registry (optional, for marketplace listing)

See `REGISTRY-SETUP.md` in the main ADB repo. Short version: fork the registry repo, add an entry to `plugins.json` with `npmPackage: "adb-plugin-reminders"`, open a PR.

## License

MIT
