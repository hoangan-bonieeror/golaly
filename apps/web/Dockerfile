# Production image for the TRIPLY web app. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t triply-web .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
# Rewrites are resolved at build time, so API_ORIGIN must be known here.
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @triply/web --workspace @triply/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @triply/shared && npm run build -w @triply/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
