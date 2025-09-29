import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export const disputeController = {
  async submitDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const { entityType, entityId, reason, evidence, contactEmail } = req.body;

      // Validate input
      if (!entityType || !entityId || !reason || !contactEmail) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Please provide entityType, entityId, reason, and contactEmail'
        });
      }

      if (!['product', 'company'].includes(entityType)) {
        return res.status(400).json({
          error: 'Invalid entity type',
          message: 'Entity type must be either "product" or "company"'
        });
      }

      // Verify entity exists
      if (entityType === 'product') {
        const product = await prisma.product.findUnique({
          where: { sku: entityId }
        });

        if (!product) {
          return res.status(404).json({
            error: 'Product not found',
            message: `No product found with SKU: ${entityId}`
          });
        }
      } else {
        const company = await prisma.company.findUnique({
          where: { id: entityId }
        });

        if (!company) {
          return res.status(404).json({
            error: 'Company not found',
            message: `No company found with ID: ${entityId}`
          });
        }
      }

      // Create dispute record (in production, this would be stored in database)
      const disputeId = uuidv4();
      const dispute = {
        id: disputeId,
        entityType,
        entityId,
        reason,
        evidence: evidence || null,
        contactEmail,
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      // In production, save to database and send email notification
      console.log('Dispute submitted:', dispute);

      // Send response
      return res.status(201).json({
        disputeId,
        status: 'pending',
        message: 'Your dispute has been submitted and will be reviewed within 3-5 business days. You will receive email updates at the provided address.',
        createdAt: dispute.createdAt
      });
    } catch (error) {
      return next(error);
    }
  }
};

export default disputeController;