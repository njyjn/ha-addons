#!/bin/sh
set -e

# 1. Parse Options
CONFIG_PATH="/data/options.json"
if [ -f "$CONFIG_PATH" ]; then
    CFG_DB_URL=$(jq -r '.database_url // empty' $CONFIG_PATH)
    CFG_PORT=$(jq -r '.port // empty' $CONFIG_PATH)
fi

# 2. Prepare Database Path
DEFAULT_DB_DIR="/share"
DEFAULT_DB_FILE="$DEFAULT_DB_DIR/chorebot.db"

if [ ! -d "$DEFAULT_DB_DIR" ]; then
    mkdir -p "$DEFAULT_DB_DIR"
fi

# 3. Set Environment Variables
if [ -n "$CFG_DB_URL" ]; then
    export DATABASE_URL="$CFG_DB_URL"
else
    export DATABASE_URL="file:$DEFAULT_DB_FILE"
fi

export PORT="${CFG_PORT:-3002}"
export OPTIONS_PATH="$CONFIG_PATH"

# 4. Run Migrations and seed the chore list on first start
cd /app
echo "Running migrations..."
npm run prisma:migrate
npm run prisma:seed

# 5. Alert loop: the app decides whether anything is due, this only ticks it
(
    sleep 30
    while true; do
        curl -fsS -X POST "http://127.0.0.1:$PORT/api/cron" >/dev/null || echo "cron tick failed"
        sleep 60
    done
) &

# 6. Start App
echo "Starting application on port $PORT..."
exec npm start -- -p "$PORT"
