# Contexto de build: raiz do monorepo (docker build -f backend/Dockerfile .)
# Mesma imagem para os dois papéis: api (padrão) e worker (command: node dist/main.worker.js).
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY backend/package.json backend/

FROM base AS build
RUN npm ci -w @gptmaker/contracts -w backend --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY backend backend
RUN npm run build -w @gptmaker/contracts && npm run build -w backend

FROM base AS prod-deps
RUN npm ci -w @gptmaker/contracts -w backend --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/package.json ./
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
WORKDIR /app/backend
USER node
EXPOSE 3001 9464
CMD ["node", "dist/main.api.js"]
