FROM node:24-bookworm-slim

# Install SoX for audio support on Linux
RUN apt-get update && apt-get install -y \
    sox \
    libsox-fmt-all \
    alsa-utils \
    pulseaudio \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first (better layer caching)
COPY package*.json ./

RUN npm ci

# Copy source
COPY . .

# Build UI + CLI
RUN npm run release

ENV NODE_ENV="production"
ENV OG_PRODUCTION="true"

EXPOSE 6753

CMD ["node", "dist/cli.js"]
