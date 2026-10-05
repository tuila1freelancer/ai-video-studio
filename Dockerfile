# The server image: the app with no readable source in it, and no desktop around it.
#
#   DOCKER_BUILDKIT=1 docker build --secret id=appkey,env=AVS_APP_KEY -t avs:latest .
#   docker run -d -p 8123:8123 -v avs-data:/data avs:latest
#
# Three stages, and the reason for each:
#   build    — bundles src/ and compiles it to encrypted V8 bytecode WITH THE IMAGE'S OWN NODE, so
#              the bytecode is produced by exactly the V8 that will run it. That is the one thing a
#              cross-compiled build from macOS cannot prove about itself.
#   launcher — the Go binary that holds the AES key and hands it to node over stdin.
#   runtime  — Debian slim plus chromium, ffmpeg and the Noto faces the renderer needs.
#
# The key arrives as a BuildKit secret, never as an ARG: an ARG is recorded in the image's own
# history, which would put the key next to the thing it unlocks.
#
# BUILD_ID is not decoration. A secret's VALUE is not part of BuildKit's cache key, so a rebuild with
# a new key happily reuses a cached bytecode layer encrypted with the old one — and the image boots
# to "không giải mã được app.jsc". Passing a fresh BUILD_ID busts both stages together, which is the
# only thing that keeps the launcher's key and the payload's key the same key.

# Pinned, not floating: the loader refuses bytecode from a different V8, so the version here is the
# version everything is compiled for.
ARG NODE_VERSION=22.22.1
ARG BUILD_ID=dev

FROM node:${NODE_VERSION}-bookworm AS build
ARG BUILD_ID
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN --mount=type=secret,id=appkey \
    set -eu; \
    echo "build ${BUILD_ID}"; \
    APP_KEY="$(cat /run/secrets/appkey)"; \
    export AVS_BYTECODE_NODE=/usr/local/bin/node; \
    node scripts/build-bundle.mjs --out /payload --map-out /private; \
    node scripts/build-bytecode.mjs --in /payload/server.cjs --out /payload --key "$APP_KEY"; \
    rm -f /payload/server.cjs; \
    node scripts/build-frontend.mjs --out /payload/public; \
    cp package.json package-lock.json /payload/; \
    mkdir -p /payload/vendor; \
    for v in gsap libs fonts; do [ -d "vendor/$v" ] && cp -R "vendor/$v" "/payload/vendor/$v" || true; done; \
    # Production dependencies at this image's own ABI — no prebuild swapping, it is already Linux.
    mkdir -p /deps && cp package.json package-lock.json /deps/ && cd /deps && npm ci --omit=dev --no-audit --no-fund; \
    cp -R /deps/node_modules /payload/node_modules; \
    find /payload \( -name '.DS_Store' -o -name '*.map' -o -name '*.ts' -o -name '*.test.js' \) -type f -delete; \
    find /payload -type f \( -iname '*.md' -o -iname '*.markdown' \) ! -iname '*licen[cs]e*' ! -iname 'notice*' -delete

FROM golang:1.23-bookworm AS launcher
ARG BUILD_ID
WORKDIR /go/src/launcher
COPY shell/win-launcher/ ./
RUN --mount=type=secret,id=appkey \
    echo "build ${BUILD_ID}" && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
      -ldflags "-s -w -X main.appKey=$(cat /run/secrets/appkey) -X main.nodeRel=/usr/local/bin/node" \
      -o /avs-launcher .

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# chromium renders every scene; ffmpeg (Debian's, with libass) encodes and burns subtitles; the Noto
# faces are what stops fontconfig silently substituting a typeface nobody chose for CJK or Thai.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg fontconfig ca-certificates curl \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
WORKDIR /app
COPY --from=build /payload /app/app-payload
COPY --from=launcher /avs-launcher /app/avs-launcher
# Paths rather than probes: /usr/bin/which is not something to depend on in a slim image.
ENV AVS_DIST=1 \
    AVS_MODE=server \
    AVS_HOST=0.0.0.0 \
    AVS_PORT=8123 \
    AVS_HEADLESS=1 \
    AVS_DATA_DIR=/data \
    AVS_CHANNELS_DIR=/data/channels \
    AVS_CHROME=/usr/bin/chromium \
    AVS_FFMPEG=/usr/bin/ffmpeg \
    AVS_FFPROBE=/usr/bin/ffprobe \
    AVS_FFMPEG_ASS=/usr/bin/ffmpeg \
    CHROME_DEVEL_SANDBOX="" \
    # The first run mints one token and prints it to the log (docker logs), because there is no way
    # to run the token command against a database that only exists inside the volume. This is a NAME,
    # not a credential — the token itself is generated inside the container. Replace it after use.
    AVS_BOOTSTRAP_TOKEN_NAME=bootstrap
# /data holds the database, the API tokens and every project: it MUST outlive the container, or
# each restart is a new installation to the owner.
VOLUME ["/data"]
RUN useradd --create-home --uid 10001 avs && mkdir -p /data && chown -R avs:avs /data /app
USER avs
EXPOSE 8123
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8123/api/health || exit 1
ENTRYPOINT ["/app/avs-launcher"]
