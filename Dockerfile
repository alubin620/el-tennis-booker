FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY booking.config.example.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV HEADLESS=false
ENV DISPLAY=:99
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["sh", "-c", "node src/settings.js & exec node src/index.js watch"]
