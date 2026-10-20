# Production image for the Golaly API. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t golaly-api .
#   docker build -f apps/api/Dockerfile --target migrate -t golaly-api-migrate .   # one-off migration job

# ── build: full toolchain (TypeScript, Nest CLI, Prisma CLI) ───────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN npm ci --workspace @golaly/api --workspace @golaly/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @golaly/shared && npm run db:generate -w @golaly/api && npm run build -w @golaly/api

# ── migrate: runs `prisma migrate deploy` once, then exits (compose: the `migrate` service) ──
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ── deps: production dependencies only ─────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @golaly/api --workspace @golaly/shared --include-workspace-root --ignore-scripts && npm cache clean --force

# ── runtime: compiled code + production deps, unprivileged user ────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
RUN mkdir -p /data/media && chown -R node:node /data
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
