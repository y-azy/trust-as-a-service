import { PrismaClient } from '@prisma/client';
import { shutdownCache } from '../src/services/cache';

const prisma = new PrismaClient();

// Global teardown - runs after all tests complete
afterAll(async () => {
  // Close Prisma connection
  try {
    await prisma.$disconnect();
    console.log('Prisma disconnected');
  } catch (error) {
    console.warn('Prisma disconnect failed:', error);
  }

  // Close cache connections (Redis or in-memory cleanup)
  try {
    await shutdownCache();
    console.log('Cache shutdown complete');
  } catch (error) {
    console.warn('Cache shutdown failed:', error);
  }
});
