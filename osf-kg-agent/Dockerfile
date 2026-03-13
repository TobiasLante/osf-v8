FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production
COPY src/ ./src/
USER node
EXPOSE 8032
CMD ["npx", "tsx", "src/index.ts"]
