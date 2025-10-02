# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trust as a Service (TaaS) is an API-first platform for explainable trust scoring of products, companies, and services. It aggregates data from public sources (NHTSA, CFPB, CPSC) and uses a deterministic scoring engine with configurable weights to produce auditable trust scores.

## Key Commands

### Backend Development
```bash
cd backend

# Database operations
npx prisma migrate dev          # Run database migrations
npx prisma studio               # Open Prisma Studio GUI
npm run seed                    # Seed initial data

# Development
npm run dev                     # Start dev server with hot reload (port 4000)
npm run build                   # Compile TypeScript to dist/
npm start                       # Run production build

# Testing
npm test                        # Run all tests
npm run test:watch             # Run tests in watch mode
npm run test:coverage          # Generate coverage report
jest src/services/trustScore.test.ts  # Run specific test file

# Connectors (fetch real data)
npm run connector:nhtsa        # Run NHTSA vehicle recalls connector
npm run connector:cfpb -- "Company Name"  # Run CFPB complaints connector
npm run connector:cpsc         # Run CPSC product recalls connector

# Score Management
npm run recompute -- --incremental  # Recompute stale scores
npm run recompute -- --full         # Recompute all scores
npm run recompute -- --cron         # Start cron job for automatic recompute
```

### Frontend Development
```bash
cd frontend

npm run dev                    # Start Next.js dev server (port 3000)
npm run build                  # Build production bundle
npm start                      # Run production build
```

### Docker Operations
```bash
# Full stack
docker compose up --build      # Build and run all services
docker compose down            # Stop all services

# Individual services
docker compose up -d postgres  # Start only PostgreSQL
docker compose up backend      # Start backend with dependencies

# Rebuild from scratch
docker compose build --no-cache && docker compose up -d
```

## Architecture & Core Concepts

### High-Level Architecture & Data Flow

```
User (text search)  ---> Frontend (Search UI / Browser Ext)  ---> API Gateway / Search API
      |                                                             |
      |                                                             v
      |                                                    Entity Resolution Service
      |                                                             |
      v                                                             v
Frontend displays results <--- Product/Company canonical object store <--- Ingest pipeline
                                                             |
                                                      Connector Manager (schedulers)
                                                     /   |    |   |    \
                                               CPSC  NHTSA CFPB  News  Retail APIs
                                                     \   |    |   |    /
                                                      Raw Events & Documents
                                                             |
                                                   Normalizer & Evidence Store
                                                      (parse, dedupe, canonicalize)
                                                             |
                                                   AI Orchestrator (LLM + Embeddings)
                                                (policy parser, summarizer, embeddings)
                                                             |
                                                    Scoring Engine & Audit Log
                                                             |
                  ---------------------------------------------------------------
                  |                                |                              |
             API: Trust Profile              Recommendations API           B2B Dashboards / Exports
             (product/company/service)         (trustFirst, costAdj)       (bulk, underwriting, SLA)
```

**Key Components:**
- **Entity Resolution Service**: Matches user queries to canonical products/companies using fuzzy matching and semantic search
- **Connector Manager**: Orchestrates scheduled data ingestion from CPSC, NHTSA, CFPB, news, and retail APIs
- **Normalizer & Evidence Store**: Parses, deduplicates, and canonicalizes raw events into structured evidence
- **AI Orchestrator**: Leverages LLM for policy parsing, summarization, and embeddings generation
- **Scoring Engine**: Deterministic trust scoring with configurable weights and audit trails
- **API Layer**: Exposes trust profiles, recommendations, and B2B analytics endpoints

### Trust Scoring Engine

The scoring engine (`backend/src/services/trustScore.ts`) is the core IP. It uses a weighted formula where:
- Weights are configurable via `backend/src/config/trustConfigs.json`
- Different product categories (automotive, appliances, electronics) have custom weight profiles
- Scores are deterministic - same inputs always produce same output
- All scores include confidence ratings based on available evidence

The scoring flow:
1. Events (recalls, complaints, policies) are fetched by connectors
2. Events are normalized and weighted based on severity and type
3. Missing data can use policy scores as proxy (with dampening factor)
4. Final score is 0-100 with letter grades (A-F)

### Policy Parser

The parser (`backend/src/parsers/policyParser.ts`) extracts warranty/policy data using a two-stage approach:
1. **Regex-first**: High-confidence extraction for structured fields (warranty length, coverage, transferability)
2. **LLM fallback**: Only when regex confidence is low (<0.7) or critical fields missing
3. Always checks robots.txt before scraping
4. Returns structured data with per-field confidence scores

### Connectors

Connectors fetch and normalize external data into Event records:
- **Active**: NHTSA (vehicle recalls), CFPB (complaints) - use real public APIs
- **Stubs**: NewsAPI, CourtListener, Trustpilot - require API keys to activate

Each connector:
- Stores raw data in `storage/raw/[connector]/`
- Normalizes to Event schema with severity scoring
- Includes provenance (source_url, fetched_at, raw_ref)
- Can run individually via CLI or in batch mode

### Recompute Job

The job (`backend/src/jobs/scoreRecompute.ts`) manages score lifecycle:
- Finds products/companies with new events or no scores
- Triggers score recalculation
- Detects large score changes for webhook alerts
- Can run incrementally, fully, or on cron schedule

### API Structure

All API endpoints require `X-API-Key` header (except /health):
- `GET /api/trust/product/:sku` - Product trust scores with evidence
- `GET /api/trust/company/:id` - Company trust scores
- `GET /api/recommendations/:sku?mode=trustFirst` - Alternative products
- `POST /api/dispute` - Submit score disputes

### Frontend Architecture

Next.js app with key pages:
- `/` - Search and featured products
- `/product/[sku]` - Detailed trust score with breakdown
- Components use real-time API calls with loading states
- Recommendation modes: trustFirst, priceFirst, effectivePrice

## Configuration

### Required Environment Variables
```
DATABASE_URL=postgresql://user:pass@localhost:5432/trustdb
OPENAI_API_KEY=sk-...  # Required for policy parsing
API_KEY_MAIN=changeme   # API authentication
```

### Optional API Keys (for connector activation)
```
NEWSAPI_KEY=            # News articles
COURTLISTENER_API_KEY=  # Legal cases
TRUSTPILOT_API_KEY=     # Business reviews
DATA_GOV_API_KEY=       # Data.gov APIs
```

### PostgreSQL Setup

The application uses PostgreSQL for all environments (local, Docker, production).

#### Local Development Setup

1. **Start PostgreSQL via Docker:**
   ```bash
   docker compose up -d postgres
   ```

2. **Configure environment variables in `backend/.env`:**
   ```bash
   DATABASE_URL="postgresql://trustuser:trustpass@localhost:5432/trustdb"
   OPENAI_API_KEY=your_openai_api_key_here
   DATA_GOV_API_KEY=your_data_gov_api_key_here
   COURTLISTENER_API_KEY=your_courtlistener_api_key_here
   ```

3. **Apply migrations and seed data:**
   ```bash
   cd backend
   npx prisma db push              # Sync schema to database
   npm run seed                    # Seed initial data
   npx ts-node src/scripts/populateRealData.ts  # Populate real data from connectors
   ```

4. **Start dev server:**
   ```bash
   npm run dev                     # Runs on http://localhost:4000
   ```

#### Docker Environment Setup

1. **Configure root `.env` file for Docker Compose:**
   ```bash
   # Create .env in project root
   OPENAI_API_KEY=your_openai_api_key_here
   DATA_GOV_API_KEY=your_data_gov_api_key_here
   COURTLISTENER_API_KEY=your_courtlistener_api_key_here
   API_KEY_MAIN=changeme
   FRONTEND_URL=http://localhost:3000
   ```

2. **Build and run all services:**
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

3. **Verify services:**
   - Backend: http://localhost:4000/health
   - Frontend: http://localhost:3000
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

#### Production Deployment

For production PostgreSQL setup:

1. **Use managed PostgreSQL service** (recommended):
   - AWS RDS, Google Cloud SQL, Azure Database, or DigitalOcean Managed Databases
   - Configure connection pooling (e.g., PgBouncer)
   - Enable SSL/TLS connections

2. **Set production DATABASE_URL:**
   ```bash
   DATABASE_URL="postgresql://user:password@prod-host:5432/database?sslmode=require"
   ```

3. **Run migrations in production:**
   ```bash
   npx prisma migrate deploy       # Apply pending migrations
   ```

4. **Environment variables for production:**
   - Set all API keys as environment variables (never commit to git)
   - Use secrets management (AWS Secrets Manager, Vault, etc.)
   - Enable `NODE_ENV=production`

## Data Flow

1. **Ingestion**: Connectors fetch from external APIs → store as Events
2. **Processing**: Policy parser extracts structured warranty data
3. **Scoring**: Recompute job aggregates Events → calculates scores
4. **API**: Controllers fetch latest scores → return with evidence
5. **Frontend**: React components display scores → fetch recommendations

## Testing Strategy

- Unit tests for scoring engine determinism (`trustScore.test.ts`)
- Policy parser tests with sample HTML (`policyParser.test.ts`)
- Connector tests use mocked HTTP responses
- Integration tests via supertest for API endpoints
- Smoke test: docker-compose → seed → recompute → API call

## Deployment Notes

The system is designed for containerized deployment with:
- PostgreSQL for persistent data
- Redis for caching (optional)
- Local storage or S3 for raw data
- Rate limiting per API key (1000 req/day default)

CI/CD via GitHub Actions runs tests and builds Docker images on PR/merge.

## Claude Code Rules:

1. First think through the problem, read the codebase for relevant files, and write a plan to a tasks.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Finally, add a review section to the tasks.md file with a summary of the changes you made and any other relevant information.
8. DO NOT BE LAZY. NEVER BE LAZY. IF THERE IS A BUG FIND THE ROOT CAUSE AND FIX IT. NO TEMPORARY FIXES. YOU ARE A SENIOR DEVELOPER. NEVER BE LAZY
9. MAKE ALL FIXES AND CODE CHANGES AS SIMPLE AS HUMANLY POSSIBLE. THEY SHOULD ONLY IMPACT NECESSARY CODE RELEVANT TO THE TASK AND NOTHING ELSE. IT SHOULD IMPACT AS LITTLE CODE AS POSSIBLE. YOUR GOAL IS TO NOT INTRODUCE ANY BUGS. IT'S ALL ABOUT SIMPLICITY

CRITICAL: When debugging, you MUST trace through the ENTIRE code flow step by step. No assumptions. No shortcuts.
