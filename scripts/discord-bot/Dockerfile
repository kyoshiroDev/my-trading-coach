FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json .
RUN pnpm install --prod --no-frozen-lockfile
COPY *.mjs .
CMD ["node", "index.mjs"]
