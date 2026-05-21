FROM node:20.11.1-slim

# 安装依赖 + 时区 + 编译环境
RUN apt-get update && apt-get install -y \
    tzdata \
    curl \
    python3 \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

ENV TZ=Asia/Shanghai
ENV DB_DIR=/app/data
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000 || exit 1

CMD ["node", "src/server.js"]
