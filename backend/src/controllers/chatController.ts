import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { getGrade } from '../utils/eventHelpers';

const prisma = new PrismaClient();

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Function definitions for OpenAI function calling
const functions = [
  {
    name: 'searchProducts',
    description: 'Search for products by name, brand, or category. Returns products with trust scores.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (product name, brand, or keywords)'
        },
        category: {
          type: 'string',
          description: 'Optional category filter (automotive, electronics, appliance, etc.)',
          enum: ['automotive', 'electronics', 'electronics_phone', 'electronics_audio', 'electronics_computer', 'appliance', 'general']
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5)',
          default: 5
        }
      },
      required: ['query']
    }
  },
  {
    name: 'getProductDetails',
    description: 'Get detailed trust score information for a specific product by SKU',
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Product SKU identifier'
        }
      },
      required: ['sku']
    }
  },
  {
    name: 'compareProducts',
    description: 'Compare trust scores of multiple products',
    parameters: {
      type: 'object',
      properties: {
        skus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product SKUs to compare'
        }
      },
      required: ['skus']
    }
  }
];

// Function implementations
async function searchProducts(query: string, category?: string, limit: number = 5) {
  const whereClause: any = {
    OR: [
      { name: { contains: query } },
      { sku: { contains: query } }
    ]
  };

  if (category) {
    whereClause.category = category;
  }

  const products = await prisma.product.findMany({
    where: whereClause,
    include: {
      company: true,
      scores: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    },
    take: limit
  });

  return products
    .filter(p => p.scores.length > 0)
    .map(p => ({
      sku: p.sku,
      name: p.name,
      brand: p.company?.name,
      category: p.category,
      score: Math.round(p.scores[0].score * 100),
      grade: getGrade(p.scores[0].score * 100),
      confidence: p.scores[0].confidence
    }));
}

async function getProductDetails(sku: string) {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      company: true,
      scores: {
        orderBy: { createdAt: 'desc' },
        take: 1
      },
      events: {
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });

  if (!product || product.scores.length === 0) {
    return null;
  }

  const score = Math.round(product.scores[0].score * 100);

  return {
    sku: product.sku,
    name: product.name,
    brand: product.company?.name,
    category: product.category,
    score,
    grade: getGrade(score),
    confidence: product.scores[0].confidence,
    eventCount: product.events.length,
    recentEvents: product.events.slice(0, 5).map(e => ({
      type: e.type,
      source: e.source,
      severity: e.severity,
      date: e.createdAt
    }))
  };
}

async function compareProducts(skus: string[]) {
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    include: {
      company: true,
      scores: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  });

  return products
    .filter(p => p.scores.length > 0)
    .map(p => ({
      sku: p.sku,
      name: p.name,
      brand: p.company?.name,
      score: Math.round(p.scores[0].score * 100),
      grade: getGrade(p.scores[0].score * 100)
    }))
    .sort((a, b) => b.score - a.score);
}

export const chatController = {
  async chat(req: Request, res: Response, next: NextFunction) {
    try {
      const { message, conversationHistory = [] } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Message is required and must be a string'
        });
      }

      // Check if OpenAI is configured
      if (!openai) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'AI chat requires OPENAI_API_KEY to be configured'
        });
      }

      // Build messages array
      const messages: any[] = [
        {
          role: 'system',
          content: `You are a helpful assistant for Trust as a Service, a platform that provides trust scores for products and companies.

You can help users:
- Search for products and their trust scores
- Get detailed information about specific products
- Compare multiple products
- Explain what trust scores mean

Trust scores range from 0-100:
- 90-100 (A): Excellent trust
- 80-89 (B): Good trust
- 70-79 (C): Fair trust
- 60-69 (D): Below average trust
- Below 60 (F): Poor trust

Use the available functions to search and retrieve product data. Be concise and helpful.`
        },
        ...conversationHistory.map((msg: any) => ({
          role: msg.role,
          content: msg.content
        })),
        {
          role: 'user',
          content: message
        }
      ];

      // Call OpenAI with function calling
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages,
        functions: functions as any,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 500
      });

      const assistantMessage = response.choices[0].message;

      // Check if function call was requested
      if (assistantMessage.function_call) {
        const functionName = assistantMessage.function_call.name;
        const functionArgs = JSON.parse(assistantMessage.function_call.arguments);

        let functionResult: any;

        // Execute the requested function
        switch (functionName) {
          case 'searchProducts':
            functionResult = await searchProducts(
              functionArgs.query,
              functionArgs.category,
              functionArgs.limit
            );
            break;
          case 'getProductDetails':
            functionResult = await getProductDetails(functionArgs.sku);
            break;
          case 'compareProducts':
            functionResult = await compareProducts(functionArgs.skus);
            break;
          default:
            functionResult = { error: 'Unknown function' };
        }

        // Send function result back to OpenAI for final response
        const finalResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            ...messages,
            assistantMessage,
            {
              role: 'function',
              name: functionName,
              content: JSON.stringify(functionResult)
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        });

        return res.json({
          response: finalResponse.choices[0].message.content,
          functionCalled: functionName,
          functionResult
        });
      }

      // No function call, return direct response
      return res.json({
        response: assistantMessage.content,
        functionCalled: null
      });

    } catch (error) {
      console.error('Chat error:', error);
      return next(error);
    }
  }
};

export default chatController;
