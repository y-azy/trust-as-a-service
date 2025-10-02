# Trust as a Service - Deployment Guide

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Docker Desktop (for containerized deployment)
- OpenAI API key (for AI chat functionality)

### Local Development Setup

#### 1. Backend Setup
```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and set:
# - DATABASE_URL to absolute path of db/trust.db
# - OPENAI_API_KEY with your OpenAI key
# - Other API keys as needed

# Initialize database
npx prisma generate
npx prisma migrate dev

# Seed database with test data
npm run seed

# Populate with real connector data
npm run populate-data

# Start development server
npm run dev
```

Backend will be available at http://localhost:4000

#### 2. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Default values should work for local development

# Start development server
npm run dev
```

Frontend will be available at http://localhost:3000

### Docker Deployment

#### 1. Start Docker Desktop

#### 2. Build and Run
```bash
# From project root
docker compose build
docker compose up -d
```

#### 3. Initialize Database
```bash
# Run migrations
docker compose exec backend npx prisma migrate deploy

# Seed database
docker compose exec backend npm run seed

# Populate with real data
docker compose exec backend npm run populate-data
```

#### 4. Access Services
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- API Docs: http://localhost:4000/api-docs
- Health Check: http://localhost:4000/health

### Environment Variables

#### Backend (.env)
```
DATABASE_URL=file:/path/to/backend/db/trust.db
OPENAI_API_KEY=your_key_here         # Required for AI chat
API_KEY_MAIN=changeme                # Change in production
PORT=4000
FRONTEND_URL=http://localhost:3000
```

#### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_API_KEY=changeme
```

## Features Implemented

### ✅ Phase 1: Real Data Integration
- Connected to NHTSA, CPSC, and CFPB APIs
- Populated database with 64 products
- Real trust scores computed from connector data

### ✅ Phase 2: Frontend Mock Data Removal
- Removed all mock data fallbacks
- Added proper error handling and loading states
- Real-time API integration

### ✅ Phase 3: Category-Aware Features
- `/api/products/featured?groupByCategory=true` - Groups products by category
- `/api/products/popular` - Returns top products for comparison
- `/api/stats` - Platform statistics

### ✅ Phase 4: AI Chat Interface
- OpenAI GPT-4 powered chat assistant
- Function calling for product search, details, and comparison
- Floating chat widget on homepage

### ✅ Phase 5: Comprehensive Testing
- Unit tests for controllers
- Integration tests for API endpoints
- Test coverage for critical paths

### ✅ Phase 6: Environment Configuration
- `.env.example` files for both frontend and backend
- Documented all required variables
- Absolute path for SQLite database

## API Endpoints

### Products
- `GET /api/products/featured` - Featured products
- `GET /api/products/featured?groupByCategory=true` - Grouped by category
- `GET /api/products/popular` - Popular products for comparison
- `GET /api/products/search?q=query` - Search products

### Trust Scores
- `GET /api/trust/product/:sku` - Detailed product trust score
- `GET /api/trust/company/:id` - Company trust score

### Search
- `GET /api/search?q=query` - Entity resolution search

### Dashboard
- `GET /api/dashboard/stats?range=30d` - Dashboard statistics
- `GET /api/stats` - Platform statistics

### AI Chat
- `POST /api/chat` - AI assistant with function calling

### Recommendations
- `GET /api/recommendations/:sku` - Alternative products

All endpoints (except `/health`) require `X-API-Key` header.

## Testing

### Run Tests
```bash
cd backend
npm test
```

### Test API Manually
```bash
# Health check
curl http://localhost:4000/health

# Get stats
curl -H "X-API-Key: changeme" http://localhost:4000/api/stats

# Search products
curl -H "X-API-Key: changeme" "http://localhost:4000/api/products/search?q=iPhone"

# AI Chat
curl -X POST -H "Content-Type: application/json" -H "X-API-Key: changeme" \
  -d '{"message":"Search for Honda cars"}' \
  http://localhost:4000/api/chat
```

## Troubleshooting

### Database Issues
- Use absolute paths in DATABASE_URL
- Ensure db directory exists
- Run `npx prisma generate` after schema changes

### API Key Issues
- Verify X-API-Key header matches API_KEY_MAIN in .env
- Check frontend NEXT_PUBLIC_API_KEY matches backend

### Docker Issues
- Ensure Docker Desktop is running
- Remove `version: '3.8'` from docker-compose.yml if you see warnings
- Use `docker compose` (V2) not `docker-compose` (V1)

### OpenAI Chat Issues
- Verify OPENAI_API_KEY is set correctly
- Check API key has sufficient credits
- Test with simple message first

## Production Considerations

1. **Change API Keys**: Update API_KEY_MAIN to strong random value
2. **Database**: Consider PostgreSQL for production (update DATABASE_URL)
3. **Redis**: Configure REDIS_URL for production caching
4. **CORS**: Update FRONTEND_URL to production domain
5. **Monitoring**: Enable TRUST_INCLUDE_DIAGNOSTICS=false in production
6. **Rate Limiting**: Current limit is 1000 req/day per API key

## Next Steps

1. **Deploy to Cloud**: AWS, Google Cloud, or similar
2. **Add More Connectors**: Expand data sources
3. **Enhanced UI**: Mobile responsiveness improvements
4. **Analytics**: Track usage and performance
5. **API Documentation**: Interactive Swagger docs at /api-docs

## Docker Deployment - Verified ✅

### Status
All containers are running successfully:
- ✅ Backend (port 4000) - Connected to Redis and SQLite
- ✅ Frontend (port 3000) - Next.js production build
- ✅ Redis (port 6379) - Caching layer operational
- ✅ PostgreSQL (port 5432) - Available for production use

### Smoke Test Results
All endpoints tested and working:
```
✓ Health Check      - Backend is healthy
✓ Stats API         - Platform statistics available
✓ Featured Products - Real product data loaded (70 products)
✓ Product Search    - Search functionality working
✓ Dashboard Stats   - Analytics endpoints operational
✓ Frontend          - UI accessible and responsive
✓ Redis             - Cache connected and responding
```

### Quick Commands
```bash
# View all services
docker compose ps

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Restart services
docker compose restart backend
docker compose restart frontend

# Stop all services
docker compose down

# Stop and remove volumes
docker compose down -v

# Run smoke tests
./smoke-test-simple.sh
```

### Note on OpenAI API Key
The AI chat feature requires OPENAI_API_KEY to be set. To enable:
1. Add to your environment: `export OPENAI_API_KEY=your_key`
2. Restart containers: `docker compose restart backend`

Without the key, chat will return: "AI chat requires OPENAI_API_KEY to be configured"

### Database
The SQLite database is mounted from `./backend/db/trust.db` containing:
- 70 products across multiple categories
- Real event data from NHTSA, CPSC, CFPB
- Computed trust scores for all products

To reset database:
```bash
docker compose down -v
rm backend/db/trust.db
docker compose up -d
docker compose exec backend npx prisma migrate deploy
# Then seed as needed
```
