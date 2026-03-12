FROM node:20-alpine

# CLI tools needed by the agent
RUN apk add --no-cache curl postgresql-client mosquitto-clients

# kubectl from bitnami
COPY --from=bitnami/kubectl:latest /opt/bitnami/kubectl/bin/kubectl /usr/local/bin/

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --production

COPY src/ ./src/

# Default: run with no flags (CronJob adds --auto-fix if needed)
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
