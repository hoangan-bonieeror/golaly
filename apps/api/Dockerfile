# Production image for the TRIPLY API. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t triply-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN npm ci --workspace @triply/api --workspace @triply/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @triply/shared && npm run db:generate -w @triply/api && npm run build -w @triply/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
# Apply pending migrations, then start. (Run `npm run db:seed` manually only in dev/demo.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
