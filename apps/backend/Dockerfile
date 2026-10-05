FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages packages
RUN npm install

FROM deps AS build
COPY apps/backend apps/backend
COPY tsconfig.base.json ./
RUN npm run prisma:generate -w @bioflow/backend && npm run build -w @bioflow/backend

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/backend/prisma apps/backend/prisma
COPY --from=build /app/packages packages
COPY --from=build /app/package.json package.json
COPY --from=build /app/apps/backend/package.json apps/backend/package.json
CMD ["sh", "-c", "npm run prisma:deploy -w @bioflow/backend && node apps/backend/dist/main.js"]
