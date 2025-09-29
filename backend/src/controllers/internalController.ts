import { Request, Response, NextFunction } from 'express';
import { searchPipeline } from '../services/searchPipeline';

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
  }
};

export default internalController;