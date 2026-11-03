# syntax=docker/dockerfile:1

# The Studio's source-editing API. Pure Node built-ins, no dependencies — the
# server code is baked in, while the editable src/ tree stays a runtime volume
# so edits made through the Studio persist on the host.

FROM node:22-alpine
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/RainerGewalt/track-forge"
LABEL org.opencontainers.image.description="Track Forge source-editing API."
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"

COPY scripts/source-api.mjs /app/source-api.mjs

ENV SOURCE_ROOT=/workspace/src
EXPOSE 3000

CMD ["node", "/app/source-api.mjs"]
