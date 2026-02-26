FROM node:20-alpine AS builder

WORKDIR /app

# Build dependencies for isolated-vm (native C++ addon)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

RUN apk del python3 make g++

COPY --from=builder /app/dist ./dist/
COPY nodered-nodes/ ./nodered-nodes/

RUN mkdir -p /tmp && chown -R 1000:3000 /app /tmp

EXPOSE 8080

ENV NODE_ENV=production

USER 1000

CMD ["node", "dist/index.js"]
