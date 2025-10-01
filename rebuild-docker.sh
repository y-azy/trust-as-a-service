#!/bin/bash

# Docker Rebuild Script for Trust as a Service
# Rebuilds and restarts all containers with the new connector changes

set -e

echo "🐳 Rebuilding Docker containers with new connector changes..."
echo ""

# Stop existing containers
echo "📦 Stopping existing containers..."
docker-compose down

# Build new images
echo "🔨 Building new Docker images..."
docker-compose build --no-cache

# Start containers
echo "🚀 Starting containers..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check status
echo "✅ Container status:"
docker-compose ps

# Test backend health
echo ""
echo "🏥 Testing backend health..."
curl -sS http://localhost:4000/health | jq || echo "Backend not responding yet, give it a few more seconds"

echo ""
echo "🎉 Docker rebuild complete!"
echo ""
echo "Services available at:"
echo "  - Backend API: http://localhost:4000/api"
echo "  - Frontend: http://localhost:3000"
echo "  - Health check: http://localhost:4000/health"
echo ""
echo "View logs with: docker-compose logs -f"
echo "Stop services with: docker-compose down"
