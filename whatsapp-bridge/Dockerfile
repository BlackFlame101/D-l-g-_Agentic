FROM node:20-slim AS base
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3001
CMD ["node", "src/index.js"]
