FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY booking.config.example.json ./

ENV HEADLESS=true
CMD ["node", "src/index.js", "watch"]
