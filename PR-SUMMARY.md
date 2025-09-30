# PR: Add Redis Service to Docker Compose

## Branch & Commit
- **Branch**: `feature/add-redis-docker`
- **Commit**: `72200a4` - chore: add redis service to docker-compose and set REDIS_URL example
- **PR URL**: https://github.com/y-azy/trust-as-a-service/pull/new/feature/add-redis-docker

## Summary
Enhanced the existing Redis service in docker-compose.yml with production-ready configuration (healthcheck, restart policy, container name) and documented REDIS_URL in .env.docker.example.

## Verification Results

### 1. Docker Containers Status
```
NAMES                           STATUS                    PORTS
trust-redis                     Up 12 seconds (healthy)   0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp
trust-as-a-service-backend-1    Up 11 seconds             0.0.0.0:4000->4000/tcp, [::]:4000->4000/tcp
```

### 2. Redis Healthcheck
```bash
$ docker exec trust-redis redis-cli ping
PONG
```
✅ **Result**: PONG received - Redis is healthy

### 3. Backend Logs Excerpt
```
Redis cache connected
✅ Database connected successfully
🚀 Server running on port 4000
📡 API available at http://localhost:4000/api
🏥 Health check at http://localhost:4000/health
Cache miss: resolve:v1:65b22052858b2bdb69c720582e0ddad324ec1feecb60c73c2a76c4d403789d9e
Entity resolver: resolving "iPhone 13 Pro Max"
Cache set: resolve:v1:65b22052858b2bdb69c720582e0ddad324ec1feecb60c73c2a76c4d403789d9e (TTL: 86400s)
```
✅ **Result**: Backend successfully connected to Redis cache

### 4. Curl Smoke Test
```bash
$ curl -X POST http://localhost:4000/api/internal/resolve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: changeme" \
  -d '{"query":"iPhone 13 Pro Max"}'
```

**Response**:
```json
{
  "ok": true,
  "result": {
    "resolved": false,
    "candidates": [
      {
        "type": "product",
        "id": "test-prod-1",
        "name": "iPhone 13 Pro",
        "sku": "IPHONE-13-PRO",
        "score": 0.4737170375014764,
        "matchType": "fuzzy"
      }
    ]
  }
}
```
✅ **Result**: API endpoint working, Redis caching operational

## Files Changed
```
docker-compose.yml        +6 lines   (added healthcheck, container_name, restart)
.env.docker.example       +1 line    (added REDIS_URL)
```

## Changes Detail

### docker-compose.yml
```yaml
redis:
  image: redis:7-alpine
  container_name: trust-redis        # NEW
  restart: unless-stopped            # NEW
  ports:
    - "6379:6379"
  healthcheck:                       # NEW
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
  networks:
    - trust-network
```

### .env.docker.example
```
REDIS_URL=redis://redis:6379       # NEW
OPENAI_API_KEY=your-openai-api-key-here
```

## Testing Instructions

```bash
# 1. Start the stack
docker-compose down
docker-compose up -d --build

# 2. Verify Redis health
docker exec trust-redis redis-cli ping
# Expected: PONG

# 3. Check backend connection
docker-compose logs backend | grep -i redis
# Expected: "Redis cache connected"

# 4. Test API endpoint
curl -X POST http://localhost:4000/api/internal/resolve \
  -H "Content-Type: application/json" \
  -H "X-API-Key: changeme" \
  -d '{"query":"test product"}'
# Expected: JSON response with ok: true
```

## Environment Variables
- **REDIS_URL**: Redis connection string (default: `redis://redis:6379`)
  - Format inside Docker: `redis://redis:6379` (uses service hostname)
  - Format for local dev: `redis://localhost:6379`
  - If missing: Backend gracefully falls back to in-memory cache

## Related Features
- Entity resolver (`/api/internal/resolve`) uses Redis for caching
- Cache TTL: 24 hours (86400 seconds)
- Cache key format: `resolve:v1:${sha256(normalized_query)}`
- Implements from PR #[previous-entity-resolver-pr]

## Notes
- Redis service already existed in docker-compose.yml but lacked production configuration
- Backend was already configured to use REDIS_URL environment variable
- No breaking changes - fully backward compatible
- Falls back to in-memory cache if Redis unavailable
