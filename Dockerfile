FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
COPY --from=build /app/app ./app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shopify.app.toml ./shopify.app.toml
COPY --from=build /app/prisma ./prisma

EXPOSE 3000
CMD ["npm", "run", "start"]
