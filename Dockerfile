# syntax=docker/dockerfile:1.7

FROM node:20-slim AS build
WORKDIR /app

ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_FETCH_TIMEOUT=300000
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false

RUN apt-get update -y && apt-get install -y openssl

COPY package*.json ./
COPY extensions/checkout-ui/package.json ./extensions/checkout-ui/package.json
COPY extensions/delivery-customization/package.json ./extensions/delivery-customization/package.json
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps --prefer-offline --progress=false
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY . .
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["npm", "run", "start"]
