# syntax=docker/dockerfile:1

FROM golang:1.24-alpine AS wasm-builder

WORKDIR /app
COPY go.mod ./
COPY wasm ./wasm

RUN mkdir -p /out && \
    GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o /out/sim.wasm ./wasm/sim && \
    if [ -f "$(go env GOROOT)/lib/wasm/wasm_exec.js" ]; then \
      cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/wasm_exec.js; \
    else \
      cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" /out/wasm_exec.js; \
    fi

FROM node:22-alpine AS client-builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY --from=wasm-builder /out/sim.wasm ./public/sim.wasm
COPY --from=wasm-builder /out/wasm_exec.js ./public/wasm_exec.js

RUN npm run build:client

FROM nginx:1.28-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-builder /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

