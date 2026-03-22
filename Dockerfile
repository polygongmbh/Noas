FROM node:20-bookworm-slim

WORKDIR /app

# Install build tools for bcrypt native module fallback
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db ./db
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
