FROM node:20-alpine

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev) for building
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript with relaxed config for Docker
RUN npx tsc --project tsconfig.docker.json

# Remove dev dependencies after build
RUN npm prune --production

# Copy config JSON files to dist (TypeScript doesn't copy non-.ts files)
RUN cp -r src/config dist/

# Expose port
EXPOSE 4000

# Create storage directories, run migrations, and run server
CMD ["sh", "-c", "mkdir -p storage/raw && npx prisma generate && npx prisma migrate deploy && npm start"]