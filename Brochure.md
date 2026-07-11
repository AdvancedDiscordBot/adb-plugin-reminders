# Reminders

Set, manage, and cancel personal reminders — delivered to your DMs with a channel fallback.

## Features

- Schedule reminders with natural language durations (e.g. `30m`, `2h`, `1d`)
- Delivered via DM; falls back to the original channel if DMs are closed
- List and cancel your active reminders at any time
- Server admins can cap the maximum reminders per user

## Commands

| Command | Description |
|---------|-------------|
| `/remind <duration> <message>` | Set a reminder |
| `/reminders list` | View your active reminders |
| `/reminders cancel <id>` | Cancel a specific reminder |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `maxPerUser` | Max active reminders per user per server | 25 |

## Notes

Reminders are stored in the bot's database and survive restarts. Delivery accuracy is within ~5 seconds of the scheduled time.
