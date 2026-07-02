FROM node:22-alpine AS base

WORKDIR /app

FROM base AS build

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .

RUN npm run build

FROM base AS production-dependencies

# Cette copie force BuildKit à attendre la fin du build et évite deux
# installations npm simultanées sur les petits VPS.
COPY --from=build /app/package.json ./package.json
COPY package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npm cache clean --force

# Le client Prisma a été généré durant le build avec les outils de développement.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

FROM base AS production

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

USER node

CMD ["npm", "run", "docker-start"]
