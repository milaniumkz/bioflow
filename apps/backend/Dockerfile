# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/backend apps/backend
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN --mount=type=secret,id=proxy_ca,required=false sh -eu -c '\
  if [ -f /run/secrets/proxy_ca ]; then \
    export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; \
    cat /etc/ssl/cert.pem /run/secrets/proxy_ca > /tmp/bioflow-ca.pem; \
    export SSL_CERT_FILE=/tmp/bioflow-ca.pem; \
  fi; \
  apk add --no-cache openssl; \
  npm ci --workspace @bioflow/backend --include-workspace-root=false; \
  npm run prisma:generate -w @bioflow/backend; \
  npm run build -w @bioflow/backend; \
  mkdir -p /runtime/apps/backend; \
  cp -a node_modules package.json package-lock.json /runtime/; \
  cp -a apps/backend/dist apps/backend/prisma apps/backend/package.json /runtime/apps/backend/; \
  if [ -d apps/backend/node_modules ]; then cp -a apps/backend/node_modules /runtime/apps/backend/; fi; \
  rm -f /tmp/bioflow-ca.pem'

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN --mount=type=secret,id=proxy_ca,required=false sh -eu -c '\
  if [ -f /run/secrets/proxy_ca ]; then cat /etc/ssl/cert.pem /run/secrets/proxy_ca > /tmp/bioflow-ca.pem; export SSL_CERT_FILE=/tmp/bioflow-ca.pem; fi; \
  apk add --no-cache font-dejavu openssl; rm -f /tmp/bioflow-ca.pem'
COPY --from=build /runtime/ ./
CMD ["sh", "-c", "npm run prisma:deploy -w @bioflow/backend && node apps/backend/dist/main.js"]
