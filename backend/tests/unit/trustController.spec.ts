import { Request, Response, NextFunction } from 'express';
import trustController from '../../src/controllers/trustController';
import { PrismaClient } from '@prisma/client';
import * as eventHelpers from '../../src/utils/eventHelpers';

// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    product: {
      findUnique: jest.fn()
    },
    score: {
      findFirst: jest.fn()
    },
    company: {
      findUnique: jest.fn()
    }
  };
  return {
    PrismaClient: jest.fn(() => mockPrismaClient)
  };
});

// Mock event helpers
jest.mock('../../src/utils/eventHelpers', () => ({
  generateEventSummary: jest.fn((event: any) => `Summary for ${event.type}`),
  getGrade: jest.fn((score: number) => {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }),
  extractPolicyScore: jest.fn((_breakdown: any) => 75),
  getPlatformLinks: jest.fn(async (sku: string) => [
    { platform: 'Amazon', url: `https://amazon.com/search?q=${sku}`, trustScore: 85 }
  ])
}));

// Mock cache
jest.mock('../../src/services/cache', () => ({
  cacheGetJson: jest.fn().mockResolvedValue(null),
  cacheSetJson: jest.fn().mockResolvedValue(undefined)
}));

// Mock scoreRecomputeJob
jest.mock('../../src/jobs/scoreRecompute', () => ({
  scoreRecomputeJob: {
    recomputeProductScore: jest.fn().mockResolvedValue(undefined),
    recomputeCompanyScore: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('trustController - Regression Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let prisma: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock request/response
    mockRequest = {
      params: { sku: 'TEST-SKU-123' }
    };

    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();

    // Get mock prisma instance
    prisma = new PrismaClient();
  });

  describe('getProductTrust', () => {
    it('should not throw when generating event summaries', async () => {
      // Mock product with events and scores
      const mockProduct = {
        id: 'product-1',
        sku: 'TEST-SKU-123',
        name: 'Test Product',
        company: {
          id: 'company-1',
          name: 'Test Company'
        },
        scores: [
          {
            id: 'score-1',
            score: 85,
            confidence: 0.9,
            breakdownJson: [
              { metric: 'policyAndWarranty', normalized: 75 }
            ],
            createdAt: new Date()
          }
        ],
        events: [
          {
            id: 'event-1',
            type: 'recall',
            source: 'CPSC',
            severity: 5,
            detailsJson: { summary: 'Product recall' },
            rawUrl: 'https://example.com',
            createdAt: new Date()
          },
          {
            id: 'event-2',
            type: 'policy',
            source: 'WARRANTY',
            severity: 0,
            detailsJson: { summary: 'Warranty info' },
            rawUrl: 'https://example.com',
            createdAt: new Date()
          }
        ]
      };

      prisma.product.findUnique.mockResolvedValue(mockProduct);
      prisma.score.findFirst.mockResolvedValue(null); // No company score

      // Execute the controller method
      await expect(
        trustController.getProductTrust(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        )
      ).resolves.not.toThrow();

      // Verify helper functions were called correctly
      expect(eventHelpers.generateEventSummary).toHaveBeenCalledTimes(2);
      expect(eventHelpers.getGrade).toHaveBeenCalledWith(85);
      expect(eventHelpers.extractPolicyScore).toHaveBeenCalled();
      expect(eventHelpers.getPlatformLinks).toHaveBeenCalledWith('TEST-SKU-123');

      // Verify response was sent
      expect(mockResponse.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle products with no events gracefully', async () => {
      const mockProduct = {
        id: 'product-1',
        sku: 'TEST-SKU-123',
        name: 'Test Product',
        company: {
          id: 'company-1',
          name: 'Test Company'
        },
        scores: [
          {
            id: 'score-1',
            score: 70,
            confidence: 0.8,
            breakdownJson: [],
            createdAt: new Date()
          }
        ],
        events: [] // No events
      };

      prisma.product.findUnique.mockResolvedValue(mockProduct);

      await expect(
        trustController.getProductTrust(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        )
      ).resolves.not.toThrow();

      // generateEventSummary should not be called for empty events
      expect(eventHelpers.generateEventSummary).not.toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should return 404 when product is not found', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await trustController.getProductTrust(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Product not found'
        })
      );
    });
  });

  describe('getCompanyTrust', () => {
    it('should not throw when formatting company products', async () => {
      mockRequest.params = { id: 'company-1' };

      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        domain: 'test.com',
        products: [
          {
            sku: 'PROD-1',
            name: 'Product 1',
            scores: [{ score: 85 }]
          },
          {
            sku: 'PROD-2',
            name: 'Product 2',
            scores: [{ score: 70 }]
          }
        ],
        scores: [
          {
            id: 'score-1',
            score: 80,
            confidence: 0.85,
            breakdownJson: [],
            createdAt: new Date()
          }
        ]
      };

      prisma.company.findUnique.mockResolvedValue(mockCompany);

      await expect(
        trustController.getCompanyTrust(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        )
      ).resolves.not.toThrow();

      // getGrade should be called for company score and each product score
      expect(eventHelpers.getGrade).toHaveBeenCalledWith(80);
      expect(eventHelpers.getGrade).toHaveBeenCalledWith(85);
      expect(eventHelpers.getGrade).toHaveBeenCalledWith(70);

      expect(mockResponse.json).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when company is not found', async () => {
      mockRequest.params = { id: 'nonexistent' };
      prisma.company.findUnique.mockResolvedValue(null);

      await trustController.getCompanyTrust(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Company not found'
        })
      );
    });
  });
});