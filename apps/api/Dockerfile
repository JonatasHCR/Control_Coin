# syntax=docker/dockerfile:1
# Layer order — lockfile, then manifests, then source — keeps the dependency
# layer cacheable across builds (ARCH03).

FROM node:22-slim AS base
# Prisma's schema engine needs libssl; slim ships without it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/config/package.json  packages/config/
COPY packages/domain/package.json  packages/domain/
COPY apps/api/package.json         apps/api/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build --workspace @cc/domain \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npx tsc -p apps/api/tsconfig.build.json

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /repo/node_modules      ./node_modules
COPY --from=build --chown=app:app /repo/packages          ./packages
COPY --from=build --chown=app:app /repo/apps/api/dist     ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://localhost:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/src/main.js"]
