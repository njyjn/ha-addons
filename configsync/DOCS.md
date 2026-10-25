# ConfigSync

Mirrors your Home Assistant configuration into a private Git repository on a
schedule, and reports the result as a sensor.

ConfigSync keeps its own clone of that repository and runs the repository's
own `bin/ha-sync.sh` in local mode against a read-only view of your config
folder. Everything that decides what is copied, redacted or refused (the
allowlists, denylist, scrub rules and gitleaks scan) lives in the private
repository, not in this app. The app only schedules the run, authenticates
with a deploy key, and reports back.

The repository must provide a `bin/ha-sync.sh` that supports local mode
(`HA_LOCAL_CONFIG`).

## Options

| Option | Default | Meaning |
|---|---|---|
| `repository` | (required) | SSH URL of the private repo, e.g. `git@github.com:<owner>/<repo>.git` |
| `branch` | `main` | Branch the sync commits to |
| `deploy_key` | (required) | Private half of a deploy key with **write** access to that repo |
| `frequency` | `daily` | `daily` or `weekly` |
| `time` | `03:40` | Time of day to run, in Home Assistant's time zone |
| `weekday` | `sun` | Day to run when `frequency` is `weekly` |
| `run_on_start` | `true` | Also run each time the app starts |
| `git_author_name` | `ConfigSync` | Commit author name |
| `git_author_email` | (required) | Commit author email |
| `notify_service` | (empty) | e.g. `mobile_app_pixel` to get a `notify.mobile_app_pixel` message when a run fails |

## The deploy key

Create a key pair with no passphrase (a passphrase-protected key is refused):

```bash
ssh-keygen -t ed25519 -N "" -C configsync -f configsync_key
```

In the private repository on GitHub: **Settings → Deploy keys → Add deploy
key**, paste `configsync_key.pub`, and tick **Allow write access**.

Paste the contents of `configsync_key` (the private half) into `deploy_key`.
The options form shows it as a single-line field, which may turn the line
breaks into spaces; ConfigSync rebuilds them. If you prefer, use **Edit in
YAML** and paste it as a block:

```yaml
deploy_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  ...
  -----END OPENSSH PRIVATE KEY-----
```

The log only ever shows the key's fingerprint. Delete the local
`configsync_key` files once the key is pasted.

## Running a sync now

- Restart the app (with `run_on_start` on), or
- send it `sync` on stdin, e.g. from a script or dashboard button:

```yaml
action: hassio.app_stdin
data:
  app: 56e5ee65_configsync
  input: sync
```

The slug prefix (`56e5ee65`) depends on how the repository was added; the
app's page in Settings shows the full slug.

## The sensor

`sensor.configsync_last_run`:

| State | Meaning |
|---|---|
| `never` | no run recorded yet |
| `running` | a run is in progress |
| `ok` | the last run succeeded, with or without a commit |
| `failed` | the last run failed; see `error` |

Attributes: `last_run`, `last_success`, `commit` (short SHA, empty when
nothing changed), `files_changed`, `error`, `next_run`.

Sensors set by an app vanish when Home Assistant restarts, so ConfigSync
re-posts it every 10 minutes.

## First-time checklist

1. Create the deploy key and add it to the repository with write access.
2. Install ConfigSync, then set `repository`, `deploy_key`,
   `git_author_email` and (optionally) `notify_service`.
3. Start the app. The log should show the key fingerprint, the clone, and
   the sync output.
4. Check `sensor.configsync_last_run` is `ok` and a `ha: sync ...` commit
   appears in the repository.
5. Turn off any other scheduled sync for the same repository, so the two do
   not both commit.

## Troubleshooting

- **`option ... is not set`**: fill in the named option.
- **`deploy key is not a valid private key`**: paste the private half, not
  the `.pub`, and use a key without a passphrase.
- **`Permission denied (publickey)`** or **`... denied to deploy key`**: the
  deploy key is missing from the repository, or lacks write access.
- **`ERROR: ...`** lines come from the repository's own `bin/ha-sync.sh`;
  they name what it refused (a denied file, a suspected secret) and nothing
  is pushed.
