FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY .swcrc ./
COPY src/ src/
COPY templates/ templates/
RUN npx swc src -d dist --copy-files --strip-leading-paths

FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY templates/ templates/
USER node
ENTRYPOINT ["node", "dist/builder/index.js"]
CMD ["--domain", "discrete"]
