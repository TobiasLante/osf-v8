# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.mjs tailwind.config.ts postcss.config.mjs tsconfig.json .env ./

RUN npm run build

# ─── Serve stage ────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=build /app/out/ /usr/share/nginx/html/

# Next.js static export: pages are /page.html, not /page/index.html
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri.html $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
