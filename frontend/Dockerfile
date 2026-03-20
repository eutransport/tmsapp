# ===========================================
# TMS Frontend - Production Dockerfile
# Multi-stage build for smaller image
# ===========================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (npm install zodat lock file automatisch wordt bijgewerkt)
RUN npm install

# Copy source code
COPY . .

# Build argument for API URL
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Build argument for allowing localhost (local development)
ARG VITE_ALLOW_LOCALHOST=false
ENV VITE_ALLOW_LOCALHOST=$VITE_ALLOW_LOCALHOST

# Build the application
RUN npm run build

# Stage 2: Production
FROM nginx:alpine AS production

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Install curl for healthcheck
RUN apk add --no-cache curl

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
