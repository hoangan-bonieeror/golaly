# Production image for the Golaly web app. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t triply-web .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
# Rewrites (/api/v1, /media) are resolved at build time, so API_ORIGIN must be known here.
ARG API_ORIGIN=http://api:4000
ARG NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
ARG NEXT_PUBLIC_MAP_STYLE_URL=
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL \
    NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @triply/web --workspace @triply/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @triply/shared && npm run build -w @triply/web

# Standalone output: a minimal server.js plus only the node_modules it actually uses.
FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# Put an edge in front that overwrites X-Forwarded-For (see deploy/nginx.conf); Next passes it through as-is.
CMD ["node", "apps/web/server.js"]
