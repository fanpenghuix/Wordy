FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

ENV DB_DIR=/app/data
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/api/words || exit 1

CMD ["node", "src/server.js"]
