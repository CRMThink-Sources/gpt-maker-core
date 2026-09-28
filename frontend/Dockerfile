# Contexto de build: raiz do monorepo (docker build -f frontend/Dockerfile .)
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/platform-sdk/package.json packages/platform-sdk/
COPY frontend/package.json frontend/
RUN npm ci -w @gptmaker/contracts -w @gptmaker/platform-sdk -w frontend --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/platform-sdk packages/platform-sdk
COPY frontend frontend
RUN npm run build -w @gptmaker/contracts -w @gptmaker/platform-sdk && npm run build -w frontend

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
