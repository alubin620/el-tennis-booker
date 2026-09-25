#!/usr/bin/env sh
# Run once on the NAS. Set BASE to the folder on your disk.
BASE="/path/to/el-tennis-booker"
set -e
mkdir -p "$BASE/config" "$BASE/auth"
if [ ! -f "$BASE/.env" ]; then
  cp -n .env.example "$BASE/.env" 2>/dev/null || cat > "$BASE/.env" <<'EOF'
PBP_EMAIL=
PBP_PASSWORD=
EOF
  echo "Edit $BASE/.env with your PlayByPoint login."
fi
if [ ! -f "$BASE/config/booking.config.json" ]; then
  curl -fsSL -o "$BASE/config/booking.config.json" \
    https://raw.githubusercontent.com/alubin620/el-tennis-booker/main/booking.config.example.json
  echo "Open the settings page on port 8890 to fill in court preferences."
fi
echo "Ready. Deploy docker-compose.omv.yml from Portainer or: docker compose -f docker-compose.omv.yml up -d"
