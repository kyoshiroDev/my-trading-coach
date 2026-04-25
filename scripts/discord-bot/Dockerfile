FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install --no-fund --no-audit
COPY *.mjs .
CMD ["node", "index.mjs"]
