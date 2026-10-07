# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package*.json tsconfig.base.json ./
COPY apps/web apps/web
COPY apps/backend/package.json apps/backend/package.json
COPY packages packages
RUN --mount=type=secret,id=proxy_ca,required=false sh -eu -c '\
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  npm ci --workspace @bioflow/web --workspace @bioflow/shared-types --workspace @bioflow/api-client --include-workspace-root=false; \
  npm run build -w @bioflow/shared-types; npm run build -w @bioflow/api-client; npm run build -w @bioflow/web; \
  mkdir -p /runtime/apps/web; \
  cp -a node_modules packages package.json package-lock.json /runtime/; \
  cp -a apps/web/.next apps/web/public apps/web/package.json /runtime/apps/web/; \
  if [ -d apps/web/node_modules ]; then cp -a apps/web/node_modules /runtime/apps/web/; fi'

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /runtime/ ./
CMD ["npm", "run", "start", "-w", "@bioflow/web"]
