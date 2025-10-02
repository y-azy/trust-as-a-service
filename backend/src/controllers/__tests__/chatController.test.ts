import { Request, Response, NextFunction } from 'express';
import { chatController } from '../chatController';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{
              message: {
                content: 'Mocked response',
                function_call: null
              }
            }]
          })
        }
      }
    }))
  };
});

// Mock Prisma
jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null)
      }
    }))
  };
});

describe('ChatController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      body: {}
    };
    mockResponse = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();

    // Set OpenAI API key for tests
    process.env.OPENAI_API_KEY = 'test-key';
  });

  describe('chat', () => {
    it('should return 400 if message is missing', async () => {
      mockRequest.body = {};

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Message is required and must be a string'
      });
    });

    it('should return 400 if message is not a string', async () => {
      mockRequest.body = { message: 123 };

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid request',
        message: 'Message is required and must be a string'
      });
    });

    it('should process valid message and return response', async () => {
      mockRequest.body = {
        message: 'Hello',
        conversationHistory: []
      };

      await chatController.chat(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        response: 'Mocked response',
        functionCalled: null
      });
    });
  });
});
