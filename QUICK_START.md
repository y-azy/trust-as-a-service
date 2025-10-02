# Trust as a Service - Quick Start Guide

## 🚀 Start Application (Docker - Recommended)

```bash
# Start all services
docker compose up -d

# Verify everything is running
docker compose ps

# Run smoke tests
./smoke-test-simple.sh
```

**Access:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- Health Check: http://localhost:4000/health

---

## 📊 Current Database Status

- **Products:** 70
- **Events:** 84 (real data from NHTSA, CPSC, CFPB)
- **Trust Scores:** 108 (computed)
- **Categories:** Automotive, Electronics, Appliances

---

## 🔑 API Key

All API endpoints require header:
```
X-API-Key: changeme
```

---

## 📡 Key Endpoints

### Platform Stats
```bash
curl -H "X-API-Key: changeme" http://localhost:4000/api/stats
```

### Search Products
```bash
curl -H "X-API-Key: changeme" \
  "http://localhost:4000/api/products/search?q=Honda"
```

### Featured Products
```bash
curl -H "X-API-Key: changeme" \
  http://localhost:4000/api/products/featured
```

### AI Chat (requires OPENAI_API_KEY)
```bash
curl -X POST -H "Content-Type: application/json" \
  -H "X-API-Key: changeme" \
  -d '{"message":"Search for iPhone"}' \
  http://localhost:4000/api/chat
```

---

## 🛠️ Useful Commands

### View Logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Restart Services
```bash
docker compose restart backend
docker compose restart frontend
```

### Stop Everything
```bash
docker compose down
```

### Database Operations
```bash
# View products (from local)
sqlite3 backend/db/trust.db "SELECT name, category FROM Product LIMIT 10;"

# Count records
sqlite3 backend/db/trust.db "SELECT COUNT(*) FROM Product;"
```

---

## 🔧 Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -ti:4000  # or :3000
# Kill it
kill -9 <PID>
```

### Docker Not Running
```bash
# Start Docker Desktop
open -a Docker
# Wait 10 seconds, then try again
```

### API Returns 401
- Check X-API-Key header is set to "changeme"
- Verify backend is running

---

## 📚 Documentation

- **Full Guide:** See `DEPLOYMENT.md`
- **Complete Summary:** See `PROJECT_COMPLETION_SUMMARY.md`
- **Implementation Details:** See `IMPLEMENTATION_PLAN.md`

---

## ✅ Verification

Run smoke tests:
```bash
./smoke-test-simple.sh
```

Should see all ✓ PASS results.

---

## 🎯 Next Steps

1. Visit http://localhost:3000
2. Try the search bar
3. Click the chat icon (bottom-right) to test AI assistant
4. Explore the comparison and dashboard features

**Everything is ready to go!**
