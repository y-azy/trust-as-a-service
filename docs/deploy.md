# Deployment Guide

## Quick Start (Docker)

1. Clone the repository
2. Copy environment files:
   ```bash
   cp backend/.env.example backend/.env
   ```

3. Edit `.env` with your keys:
   - `OPENAI_API_KEY` (required for policy parsing)
   - Other API keys as needed

4. Build and run:
   ```bash
   docker-compose up --build
   ```

5. Access:
   - Frontend: http://localhost:3000
   - API: http://localhost:4000
   - Health: http://localhost:4000/health

## Production Deployment

### Option 1: Docker Swarm

```bash
docker swarm init
docker stack deploy -c docker-compose.yml trust-stack
```

### Option 2: Kubernetes

1. Build images:
   ```bash
   docker build -t trust-backend:latest ./backend
   docker build -t trust-frontend:latest ./frontend
   ```

2. Push to registry:
   ```bash
   docker tag trust-backend:latest your-registry/trust-backend:latest
   docker push your-registry/trust-backend:latest
   ```

3. Apply manifests:
   ```bash
   kubectl apply -f k8s/
   ```

### Option 3: Cloud Platforms

#### AWS ECS
1. Push images to ECR
2. Create task definitions
3. Deploy services

#### Google Cloud Run
```bash
gcloud run deploy trust-backend \
  --image gcr.io/project/trust-backend \
  --platform managed \
  --region us-central1
```

#### Heroku
```bash
heroku create trust-api
heroku addons:create heroku-postgresql:hobby-dev
heroku addons:create heroku-redis:hobby-dev
git push heroku main
```

### Option 4: Vercel + Render

Frontend (Vercel):
1. Connect GitHub repo
2. Set root directory: `/frontend`
3. Add environment variables
4. Deploy

Backend (Render):
1. Create Web Service
2. Connect repo
3. Set build command: `cd backend && npm install && npm run build`
4. Set start command: `cd backend && npm start`
5. Add PostgreSQL database

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string
- `API_KEY_MAIN`: Main API key for authentication
- `OPENAI_API_KEY`: OpenAI API key for policy parsing

### Optional
- `REDIS_URL`: Redis connection (caching)
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`: AWS S3 storage
- `NEWSAPI_KEY`: News API integration
- `TRUSTPILOT_API_KEY`: Trustpilot reviews
- `GOOGLE_PLACES_API_KEY`: Google Places data

## Database Setup

1. Run migrations:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```

2. Seed initial data:
   ```bash
   npm run seed
   ```

3. Start recompute job:
   ```bash
   npm run recompute -- --cron
   ```

## SSL/TLS Configuration

For production, use reverse proxy (nginx/caddy) with SSL:

```nginx
server {
    listen 443 ssl;
    server_name api.trustasaservice.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Monitoring

### Health Checks
- Backend: `GET /health`
- Database: Check connection pool
- Redis: PING command

### Logging
- Application logs: stdout/stderr
- Access logs: nginx/reverse proxy
- Error tracking: Sentry integration (optional)

### Metrics
- Response times
- API usage per key
- Score computation time
- Connector success rates

## Scaling

### Horizontal Scaling
- Backend: Multiple instances behind load balancer
- Database: Read replicas for queries
- Redis: Cluster mode for caching

### Vertical Scaling
- Increase container resources
- Upgrade database tier
- Add more workers for jobs

## Backup & Recovery

1. Database backups:
   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. Object storage sync:
   ```bash
   aws s3 sync ./storage s3://backup-bucket/
   ```

3. Configuration backup:
   - Version control for code
   - Secure storage for .env files

## Security Checklist

- [ ] Change default API keys
- [ ] Enable HTTPS/TLS
- [ ] Set secure database passwords
- [ ] Configure firewall rules
- [ ] Enable rate limiting
- [ ] Set up monitoring alerts
- [ ] Regular security updates
- [ ] Audit log retention

## Troubleshooting

### Common Issues

1. **Database connection failed**:
   - Check DATABASE_URL format
   - Verify network connectivity
   - Check PostgreSQL logs

2. **Frontend can't reach API**:
   - Verify NEXT_PUBLIC_API_URL
   - Check CORS settings
   - Verify API is running

3. **Connectors not working**:
   - Check API keys in .env
   - Verify network access
   - Check robots.txt compliance

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/trust-as-a-service/issues
- Documentation: /docs
- API Reference: /backend/openapi.yaml