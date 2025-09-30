import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { searchPipeline } from '../services/searchPipeline';
import { resolveEntity } from '../services/entityResolver';

export const internalController = {
  /**
   * Run search pipeline for a query
   * POST /internal/search/run
   */
  async runSearchPipeline(req: Request, res: Response, next: NextFunction) {
    try {
      const { query } = req.body;

      if (!query) {
        return res.status(400).json({
          error: 'Missing required field',
          message: 'Please provide query in request body'
        });
      }

      const result = await searchPipeline.runSearchPipeline(query);

      return res.json(result);
    } catch (error) {
      return next(error);
    }
  },

  /**
   * Resolve text query to entity (product or company)
   * POST /api/internal/resolve
   */
  async resolveEntity(req: Request, res: Response, next: NextFunction) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          ok: false,
          error: 'Validation error',
          details: errors.array()
        });
      }

      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'Bad request',
          message: 'Please provide query as a string in request body'
        });
      }

      if (query.trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Bad request',
          message: 'Query cannot be empty'
        });
      }

      // Resolve entity
      const result = await resolveEntity(query);

      return res.json({
        ok: true,
        result
      });
    } catch (error) {
      console.error('Entity resolver error:', error);
      return next(error);
    }
  }
};

// Validation middleware for resolve endpoint
export const resolveValidation = [
  body('query')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Query must be a non-empty string')
    .isLength({ max: 500 })
    .withMessage('Query must be less than 500 characters')
];

export default internalController;