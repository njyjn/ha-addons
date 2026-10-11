# ChoreBot - Household Chore Tracker

Digital version of the Weekly Household Chore Tracker sheet. The helper ticks
chores off on the guardhouse tablet, ticks are stored locally in SQLite, and
Home Assistant gets a sensor plus a nightly alert listing anything left undone.

## Features

- **Checklist**: today's chores grouped into *To do*, *Coming up*, *Done* and
  *Not due*. Tap to tick, tap again to undo. Past days can be backfilled.
- **Week grid**: Sun–Sat view that mirrors the paper sheet.
- **Manage**: add, edit or remove chores. Removing archives the chore, so its
  history is kept.
- **Reminders banner**: the "cannot forget" list, always on screen.
- **Alerts**: one digest per day at `alert_time` listing every overdue chore,
  sent through a Home Assistant notify service and/or a Slack webhook.
- **Sensor**: `sensor.chorebot_outstanding` (count of chores due and not done),
  refreshed every minute and on every tick, with the list in the `outstanding`
  attribute.

The chore list from the sheet is seeded on first start. After that the
database is the source of truth.

## When a chore counts as overdue

Weeks run Sunday to Saturday, as on the sheet.

| Frequency | Due when |
|---|---|
| Daily | Not ticked today |
| Every N days | N or more days since the last tick |
| X / week | Fewer ticks this week than the pace needs: 2x/week needs 1 by Wednesday and 2 by Saturday; 1x/week needs 1 by Saturday |
| X / month | Same pacing over the month: 1x/month is due on the last day |

## Options

| Option | Default | Notes |
|---|---|---|
| `database_url` | `file:/share/chorebot.db` | Leave empty for the default |
| `port` | `3002` | |
| `helper_name` | `Aye Aye` | Recorded on each tick, shown in the header |
| `alert_time` | `20:00` | Local time (`HH:MM`) the daily digest is sent |
| `notify_service` | | e.g. `notify.nswuco` or `notify.mobile_app_jnw_16pm` |
| `notify_target` | | Passed as `target`, e.g. `#wucasa-chores` for the Slack notifier |
| `slack_webhook_url` | | Optional, independent of `notify_service` |
| `reminders_title` | `TAKING CARE OF ZARA - CANNOT FORGET` | |
| `reminders` | the five lines from the sheet | Empty list hides the banner |

Times use the Home Assistant time zone, which the Supervisor passes to the add-on.

To check notifications without waiting for `alert_time`:

```bash
curl -X POST "http://<ha-host>:3002/api/cron?test=1"
```

## Guardhouse dashboard

Add to the Apps view next to BabyBot (point a reverse-proxy hostname at port
3002 first, as for `bb.intra.ngsim.net`, because the dashboard is served over HTTPS):

```yaml
type: custom:addon-iframe-card
url: https://<chorebot-hostname>
aspect_ratio: 100%
grid_options:
  columns: full
  rows: 12
```

And a badge for the outstanding count:

```yaml
type: entity
entity: sensor.chorebot_outstanding
```

## Development

```bash
npm install
DATABASE_URL="file:./data/chorebot.db" npx prisma migrate deploy
DATABASE_URL="file:./data/chorebot.db" npm run prisma:seed
DATABASE_URL="file:./data/chorebot.db" npm run dev
npm test             # scheduling rules
```
