FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN npm install

FROM deps AS build
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN npm run build -w @bioflow/shared-types && npm run build -w @bioflow/api-client && npm run build -w @bioflow/web

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/package-lock.json package-lock.json
COPY --from=build /app/packages packages
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/web/package.json apps/web/package.json
CMD ["npm", "run", "start", "-w", "@bioflow/web"]
