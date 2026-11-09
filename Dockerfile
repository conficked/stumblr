FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV STUMBLR_DB_PATH=/var/data/stumblr-ops.sqlite

RUN groupadd --system --gid 1001 stumblr \
  && useradd --system --uid 1001 --gid stumblr stumblr \
  && mkdir -p /var/data \
  && chown stumblr:stumblr /var/data

COPY --from=builder --chown=stumblr:stumblr /app/public ./public
COPY --from=builder --chown=stumblr:stumblr /app/.next/standalone ./
COPY --from=builder --chown=stumblr:stumblr /app/.next/static ./.next/static
COPY --from=builder --chown=stumblr:stumblr /app/db/migrations ./db/migrations

USER stumblr
VOLUME ["/var/data"]
EXPOSE 3000
CMD ["node", "server.js"]
