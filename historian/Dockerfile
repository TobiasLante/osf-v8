FROM node:20-alpine

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production
COPY src/ ./src/
RUN mkdir -p /data/historian-buffer && chown node:node /data/historian-buffer

USER node
EXPOSE 8030

CMD ["npx", "tsx", "src/index.ts"]
