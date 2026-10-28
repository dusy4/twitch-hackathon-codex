FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY migrations ./migrations
COPY tsconfig.json vite.config.ts ./
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3400 DEMO_ENABLED=false
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3400
CMD ["node","--import","tsx","apps/api/main.ts"]
