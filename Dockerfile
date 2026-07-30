FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# frontend/vendor/nodal-ui must already exist — run scripts/vendor-nodal-ui.sh
# before building this image (see that script for why: it lets @nodal/ui stay
# a genuinely separate sibling repo without widening this image's build context).
COPY frontend/package.json frontend/package-lock.json* ./
COPY frontend/vendor ./vendor
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

# Install build tools for bcrypt native module fallback
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ curl jq \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db ./db
COPY src ./src
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
