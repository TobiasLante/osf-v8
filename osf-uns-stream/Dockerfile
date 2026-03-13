FROM node:20-alpine
RUN adduser -D appuser
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production
COPY src/ ./src/
USER appuser
EXPOSE 8033
CMD ["npx", "tsx", "src/index.ts"]
