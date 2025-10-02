#!/bin/bash

echo "=========================================="
echo "Trust as a Service - Smoke Tests"
echo "=========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function for tests
test_endpoint() {
    local name=$1
    local url=$2
    local expected=$3
    local headers=$4
    
    echo -n "Testing $name... "
    
    if [ -n "$headers" ]; then
        response=$(curl -s $headers "$url")
    else
        response=$(curl -s "$url")
    fi
    
    if echo "$response" | grep -q "$expected"; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo "  Expected: $expected"
        echo "  Got: $response" | head -c 200
        ((FAILED++))
    fi
}

echo "1. Health Check"
test_endpoint "Backend Health" "http://localhost:4000/health" "healthy"
echo ""

echo "2. API Authentication"
test_endpoint "With API Key" "http://localhost:4000/api/stats" "totalProducts" "-H 'X-API-Key: changeme'"
test_endpoint "Without API Key" "http://localhost:4000/api/stats" "error"
echo ""

echo "3. Product APIs"
test_endpoint "Featured Products" "http://localhost:4000/api/products/featured" "sku" "-H 'X-API-Key: changeme'"
test_endpoint "Popular Products" "http://localhost:4000/api/products/popular" "score" "-H 'X-API-Key: changeme'"
test_endpoint "Product Search" "http://localhost:4000/api/products/search?q=iPhone" "results" "-H 'X-API-Key: changeme'"
echo ""

echo "4. Dashboard & Stats"
test_endpoint "Platform Stats" "http://localhost:4000/api/stats" "avgScore" "-H 'X-API-Key: changeme'"
test_endpoint "Dashboard Stats" "http://localhost:4000/api/dashboard/stats" "topProducts" "-H 'X-API-Key: changeme'"
echo ""

echo "5. Frontend"
test_endpoint "Homepage" "http://localhost:3000" "Trust as a Service"
echo ""

echo "=========================================="
echo "Test Results"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
