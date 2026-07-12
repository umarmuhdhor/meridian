# Meridian — single image, PM2 runs the daemon + the Next.js dashboard.
# node:22-bookworm-slim: repo requires Node >=22 (package.json engines).
# Build tools kept for any optional native dep in the Solana/Meteora chain.
FROM node:22-bookworm-slim

# procps → pm2 needs `ps`; python3/make/g++ cover optional native gyp builds.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pm2

WORKDIR /app

# Install deps first (better layer caching). NODE_ENV is unset here so npm
# installs devDependencies (typescript, next) needed for the build.
# scripts/ copied before install so the `postinstall` (patch-anchor.js —
# fixes @coral-xyz/anchor + @meteora-ag/dlmm ESM directory imports + BN export
# on Node 22) can run against the freshly installed node_modules.
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY dashboard/web/package.json dashboard/web/package-lock.json ./dashboard/web/
RUN cd dashboard/web && npm ci

# Copy source and build both the daemon (tsc -> dist) and the web app.
COPY . .
RUN npm run build \
  && cd dashboard/web && npm run build

# pm2-runtime is PID 1: supervises daemon + web, forwards signals, streams logs
# to `docker logs`. State/logs live on the /opt/data volume (compose).
CMD ["pm2-runtime", "ecosystem.config.cjs"]
