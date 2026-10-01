# Reminders

Set, manage, and cancel personal reminders — delivered to your DMs with a channel fallback.

## Features

- Schedule reminders with duration shorthand (e.g. `30m`, `2h`, `1d`)
- Delivered via DM; falls back to the original channel if DMs are closed
- List and cancel your active reminders at any time
- Server admins can cap the maximum reminders per user

## Commands

| Command | Description |
|---------|-------------|
| `/remind set time:<duration> message:<text>` | Set a reminder (up to 1000 characters) |
| `/remind list [page]` | View your active reminders, five per page |
| `/remind cancel id:<id>` | Cancel a specific reminder |

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `maxPerUser` | Max active reminders per user per server | 25 |

## Notes

Reminders are stored in the bot's database and survive restarts. Core checks due reminders once per minute in batches of at most 100. Delivery pauses while the plugin is disabled for the server. Failed deliveries remain pending with a five-minute initial retry delay, increasing to at most one hour. See the README for acknowledgement and restart limitations.
