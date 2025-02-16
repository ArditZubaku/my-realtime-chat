# Use Node.js v22 as the base for building and running NestJS
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
COPY package-lock.json ./

RUN npm ci

# Copy source code
COPY . .

# Build the NestJS project
RUN npm run build

# Now create a final lightweight image
FROM node:22-alpine

WORKDIR /app

# Copy only compiled dist and node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Expose the NestJS port
EXPOSE 3000

# Default command to run
CMD ["node", "dist/main.js"]
