# syntax=docker/dockerfile:1

# Self-contained LAN player image. The build stage reproduces exactly what
# setup.sh generates — CC0 samples, timeline previews, image manifest and the
# Vite bundle — and the runtime stage serves the result from nginx. Only the
# TLS certificates are mounted at runtime; everything else is baked in.

FROM node:22-alpine AS build
WORKDIR /app

# Install against the committed lockfile before copying sources so the layer
# caches across content-only changes.
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY . .

# Mirror the asset steps of setup.sh. Supplementary sample downloads may be
# blocked on a restricted network; fall back to the VCSL seed like setup.sh.
RUN npm run samples:seed \
 && (npm run samples:download || echo "supplementary sample downloads failed — continuing with VCSL only") \
 && npm run samples:curate \
 && npm run samples:build \
 && npm run samples:audit \
 && npm run timeline:previews \
 && npm run images:manifest \
 && npm run pieces:validate \
 && npm run build

FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/RainerGewalt/track-forge"
LABEL org.opencontainers.image.description="Track Forge LAN player: nginx serving the baked Studio build."
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443