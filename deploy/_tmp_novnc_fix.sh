#!/bin/bash
# Temporary one-shot: sync API noVNC path fix + recreate api; verify agent :6080.
set -euo pipefail
cd /home/ubuntu/yambot/deploy

echo "=== disk index.js wsPath ==="
grep -n "wsPath\|path=websockify\|desktop/websockify" ../backend/src/index.js | head -20 || true

echo "=== rebuild api only ==="
docker-compose up -d --build --force-recreate api
sleep 6

echo "=== inside container ==="
docker exec deploy-api-1 grep -n "wsPath\|desktop/websockify\|path=websockify" /app/src/index.js | head -20 || true

A=$(docker ps --format '{{.Names}}' | grep '^yambot-agent-' | head -1 || true)
echo "AGENT=$A"
if [ -n "$A" ]; then
  docker exec deploy-api-1 node -e '
    const http=require("http");
    const name=process.argv[1];
    http.get("http://"+name+":6080/vnc.html", (r) => {
      console.log("novnc_http", r.statusCode);
      r.resume();
    }).on("error", (e) => console.log("novnc_err", e.message));
  ' "$A"
  docker exec "$A" sh -c 'ps aux | grep -E "websockify|x11vnc|Xvfb" | grep -v grep' || true
fi

curl -s https://bot.vughy.com/api/health; echo
echo ALL_OK
