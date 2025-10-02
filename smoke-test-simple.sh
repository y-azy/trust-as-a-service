#!/bin/bash
echo "=== Docker Smoke Tests ==="
echo ""

echo "✓ 1. Health Check:"
curl -s http://localhost:4000/health | grep -q "healthy" && echo "  PASS: Backend is healthy" || echo "  FAIL"

echo ""
echo "✓ 2. Stats API:"
curl -s -H "X-API-Key: changeme" http://localhost:4000/api/stats | grep -q "totalProducts" && echo "  PASS: Stats endpoint working" || echo "  FAIL"

echo ""
echo "✓ 3. Featured Products:"
curl -s -H "X-API-Key: changeme" http://localhost:4000/api/products/featured | grep -q "sku" && echo "  PASS: Featured products endpoint working" || echo "  FAIL"

echo ""
echo "✓ 4. Product Search:"
curl -s -H "X-API-Key: changeme" "http://localhost:4000/api/products/search?q=iPhone" | grep -q "results" && echo "  PASS: Search endpoint working" || echo "  FAIL"

echo ""
echo "✓ 5. Dashboard:"
curl -s -H "X-API-Key: changeme" http://localhost:4000/api/dashboard/stats | grep -q "topProducts" && echo "  PASS: Dashboard endpoint working" || echo "  FAIL"

echo ""
echo "✓ 6. Frontend:"
curl -s http://localhost:3000 | grep -q "Trust as a Service" && echo "  PASS: Frontend is running" || echo "  FAIL"

echo ""
echo "✓ 7. Redis:"
docker compose exec redis redis-cli ping | grep -q "PONG" && echo "  PASS: Redis is connected" || echo "  FAIL"

echo ""
echo "=== All Docker smoke tests completed ==="
