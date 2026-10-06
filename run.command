#!/bin/bash
# Double-click to run AI Video Studio in your default browser (no native build needed).
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
PORT="${AVS_PORT:-8123}"
echo "🎬 Starting AI Video Studio on http://127.0.0.1:$PORT …"
AVS_PORT="$PORT" node src/server.js &
SERVER_PID=$!
# wait for health
for i in $(seq 1 60); do
  if curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.4
done
open "http://127.0.0.1:$PORT"
echo "Running (PID $SERVER_PID). Close this Terminal window to stop it."
wait $SERVER_PID
