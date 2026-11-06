# Build context: repository root (needs ./frontend and ./caddy).

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

FROM caddy:2.11-alpine
COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /app/dist /srv
# Run as an unprivileged user. The caddy binary carries cap_net_bind_service
# (and Docker allows unprivileged low ports by default), so :80/:443 still work.
RUN addgroup -S -g 10002 caddy && adduser -S -D -H -u 10002 -G caddy caddy \
    && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8081/ || exit 1
