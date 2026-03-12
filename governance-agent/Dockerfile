FROM node:20-alpine

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production
COPY src/ ./src/

EXPOSE 8031

CMD ["npx", "tsx", "src/index.ts"]
