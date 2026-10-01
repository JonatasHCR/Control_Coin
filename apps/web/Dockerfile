# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json        apps/web/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @cc/domain \
 && npm run build --workspace @cc/web

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
# Next traces only what it needs into `standalone`.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public           ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
