# Trust as a Service (TaaS)

An API-first, explainable trust-scoring platform for products, companies, and services.

## Features
- Real-time trust scoring based on public data sources
- Policy/warranty text analysis with LLM assistance
- REST API for programmatic access
- Consumer web UI with recommendations
- Chrome extension for real-time trust overlays
- Deterministic, auditable scoring engine

## Quick Start
```bash
# Backend setup
cd backend
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev

# Docker setup (alternative)
docker-compose up
```

## Architecture
- **Backend**: Node.js + TypeScript + Express + Prisma
- **Frontend**: Next.js + TypeScript + Tailwind CSS
- **Database**: PostgreSQL
- **Caching**: Redis (optional)
- **Storage**: S3 or local filesystem

## Documentation
- [Connectors Guide](./docs/connectors.md)
- [Legal & Compliance](./docs/legal.md)
- [Deployment Guide](./docs/deploy.md)
- [API Documentation](./backend/openapi.yaml)

## License
MIT