# --- Build Stage ---
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files and install
COPY package.json ./
COPY package-lock.json ./

RUN npm ci

# Copy all client files
COPY . .

# Build for production
RUN npm run build

# --- Production Stage ---
FROM nginx:stable-alpine

# Copy compiled build files from previous stage into /usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html

# Add script to replace environment variables
RUN apk add --no-cache bash
COPY env.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/env.sh

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
