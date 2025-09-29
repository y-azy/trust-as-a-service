import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const healthController = {
  async check(_req: Request, res: Response) {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;

      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();

      res.status(200).json({
        status: 'healthy',
        uptime,
        timestamp: new Date().toISOString(),
        service: 'trust-as-a-service-api',
        version: '1.0.0',
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: 'Database connection failed',
        timestamp: new Date().toISOString()
      });
    }
  }
};

export default healthController;