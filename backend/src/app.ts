import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Import controllers
import { trustController } from './controllers/trustController';
import { recommendationController } from './controllers/recommendationController';
import { healthController } from './controllers/healthController';
import { disputeController } from './controllers/disputeController';
import { internalController, resolveValidation } from './controllers/internalController';

// Import middleware
import { apiKeyMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app: Application = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1000, // limit each API key to 1000 requests per day
  message: 'Too many requests, please try again later.',
  keyGenerator: (req) => {
    return (req.headers['x-api-key'] as string) || req.ip || 'anonymous';
  }
});

app.use('/api', limiter);

// Health check (no auth required)
app.get('/health', healthController.check);

// API routes (require auth)
app.use('/api', apiKeyMiddleware);

// Trust endpoints
app.get('/api/trust/product/:sku', trustController.getProductTrust);
app.get('/api/trust/company/:id', trustController.getCompanyTrust);

// Products endpoints
app.get('/api/products/featured', trustController.getFeaturedProducts);
app.get('/api/products/search', trustController.searchProducts);

// Dashboard endpoints
app.get('/api/dashboard/stats', trustController.getDashboardStats);

// Recommendation endpoint
app.get('/api/recommendations/:sku', recommendationController.getRecommendations);

// Dispute endpoint
app.post('/api/dispute', disputeController.submitDispute);

// Internal endpoints (require auth)
app.post('/internal/search/run', internalController.runSearchPipeline);
app.post('/api/internal/resolve', resolveValidation, internalController.resolveEntity);

// Error handling
app.use(errorHandler);

export default app;