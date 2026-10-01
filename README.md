# adb-plugin-reminders

Personal reminders for [Advanced Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot).

`/remind set time:10m message:"check the oven"` — bot DMs you when it's due (falls back to the channel you set it in if DMs are closed).

## Commands

- `/remind set time:<10m|2h|1d|30s> message:<text>` — create a reminder
- `/remind list [page]` - list your pending reminders in this server, five per page
- `/remind cancel id:<id>` — cancel one (id comes from `/remind list`)

## How it works

- Reminders are stored in Mongo via `ctx.defineModel("reminder", schema)` → collection `plugin_adb-plugin-reminders_reminder`.
- Core runs a cron job (`* * * * *`, every minute) registered through `ctx.scheduler`. The plugin does not bundle or start its own cron service.
- The database query selects due, unnotified reminders whose retry time has arrived, orders by due date, and returns at most 100 rows. Future reminders are not loaded into memory.
- Commands are server-only and replies are ephemeral. Reminder text must be nonblank and at most 1000 characters. Lists show shortened previews but retain every ID across pages.
- `config.data.maxPerUser`, read from `ctx.db.getPluginConfig(guildId, "adb-plugin-reminders")` on each creation, caps pending reminders per user per server. The default is 25, with the existing schema range of 1-200. Numeric settings are rounded down and clamped to that range; missing/non-numeric settings use the default.

## Delivery and retries

- Scheduled delivery requires the plugin config's top-level `enabled === true`. Missing or disabled configs do not authorize delivery. Disabled rows are deferred for five minutes without consuming an attempt, so they cannot continually occupy the front of a capped batch.
- Delivery tries a DM first, then the original channel if the DM fails. Enable state is checked for each reminder and again before channel fallback. User-supplied mentions are neutralized; only the fallback recipient may be pinged.
- Delivery text is capped at 1900 characters before adding the fallback recipient, keeping oversized legacy messages sendable without changing their stored text.
- A conditional `updateOne` reserves the reminder before sending and persists `nextAttemptAt` and `attempts`. Overlapping ticks in the same loaded plugin are skipped; competing runners cannot claim the same row during its reservation.
- Only a successful send marks `notified: true`. If both destinations fail, the reminder remains pending and retries after 5, 10, 20, 40, then 60 minutes, with subsequent retries at hourly intervals. Cancelling removes it from this retry queue.
- If Discord succeeds but its acknowledgement cannot be stored, the running plugin remembers that one reminder and pauses new sends while retrying only the database acknowledgement. It does not fall back or send the same message again on subsequent ticks.
- Direct-mode unload removes the plugin's scheduled job and stops unstarted sends, including the rest of an active batch. A send already in flight may finish and be acknowledged. Core owns worker cron cleanup on termination.
- Delivery is normally within the next minute, not five seconds. Backlogs, disabled guilds, failures, and retry delays can make it later. Legacy rows without retry fields remain eligible; previously mis-marked `notified: true` rows cannot be distinguished automatically from genuinely delivered reminders.

Discord sends and Mongo writes are not one transaction. If the process dies or an unload discards an outstanding acknowledgement after Discord accepts a message, delivery may repeat after the reservation expires. This is not an exactly-once delivery guarantee; a transport timeout can also have an ambiguous outcome.

## Runtime contract

`lib/runtime.js` deliberately adapts only these shipped differences:

| Operation | Direct mode | Worker mode |
|---|---|---|
| Schedule | `ctx.scheduler.schedule(name, expression, callback)` | `ctx.scheduler.schedule(expression, callback, name)` |
| Delivery | `ctx.client.users.fetch(id).send(payload)` / `ctx.client.channels.fetch(id).send(payload)` | `ctx.discord.sendDM(id, payload)` / `ctx.discord.sendToChannel(id, payload)` |
| Task identity | Plugin-prefixed name in the shared scheduler | Broker-returned task ID, routed by Core to the callback |

Storage uses the common `find().sort().skip().limit().lean()`, `countDocuments`, `create`, `updateOne`, and `deleteOne` APIs, not worker-only static `Model.save`. `updateOne` must return `acknowledged`, `matchedCount`, and `modifiedCount`. Configs must expose both `enabled` and `data`.

The manifest stays isolated with its existing `storage:own-collection`, `discord:SendMessages`, and `scheduler:cron` capabilities. It does not request `raw-client`. Core must support nested slash-command options, reply forwarding, query options, schema serialization, and cron events matched to the broker-returned task ID. Older Core builds that compare an unprefixed task name to the broker's prefixed ID cannot dispatch the scheduled callback; that is a Core transport fix, not a plugin-side signature fallback.

**Restart required when upgrading an already-loaded plugin.** Core reuses compiled
Mongoose models, so a hot reload can retain the old schema and discard writes to
`nextAttemptAt`/`attempts`. The manifest sets `requiresRestart: true` to prevent
that upgrade path. A fresh Core process compiles the new schema; existing rows
need no backfill because missing retry fields are handled explicitly.

## Local testing (no bot, no Mongo required)

```bash
npm install
npm test
```

Runs `test/local-harness.js` against both direct and worker contract doubles in `test/mock-ctx.js`. Tests call the registered `execute(interaction, client)` handler (the second argument is never `ctx`) and drive registered cron callbacks with a controlled clock. Coverage includes guild limits, malformed IDs/input, paging, database-side batching, enable gates, competing ticks/claims, failed sends, and acknowledgement failures.

The doubles use real Mongoose casting/defaults/validation without connecting to Mongo. They do not run Core's RPC broker or cron transport; passing tests is not a live Discord delivery test.

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

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file for details.

This repository follows the policies of the main ADB project.

- **Contribution Guidelines**: [CONTRIBUTING.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CONTRIBUTING.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CODE_OF_CONDUCT.md)
- **Security Policy**: [SECURITY.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/SECURITY.md)
