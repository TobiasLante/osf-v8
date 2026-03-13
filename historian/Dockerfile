FROM node:20-alpine

RUN adduser -D -u 1000 appuser

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production
COPY src/ ./src/
RUN mkdir -p /data/historian-buffer && chown appuser:appuser /data/historian-buffer

USER appuser
EXPOSE 8030

CMD ["npx", "tsx", "src/index.ts"]
