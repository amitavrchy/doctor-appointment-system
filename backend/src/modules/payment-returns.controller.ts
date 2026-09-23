import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validation';
import { paymentProvider } from './payment.providers';
import { ReconciliationService } from './reconciliation.service';
@Controller('payments')
export class PaymentReturnsController {
  constructor(
    private db: PrismaService,
    private reconcile: ReconciliationService,
  ) {}
  @Get('providers') providers() {
    return ['demo', 'stripe', 'bkash', 'sslcommerz'].flatMap((name) => {
      try {
        paymentProvider(name);
        return [
          {
            name,
            label: (
              {
                demo: 'Demo checkout',
                stripe: 'Card · Stripe',
                bkash: 'bKash',
                sslcommerz: 'SSLCommerz',
              } as Record<string, string>
            )[name],
          },
        ];
      } catch {
        return [];
      }
    });
  }
  private async verify(provider: string, input: unknown) {
    if (!['bkash', 'sslcommerz'].includes(provider))
      throw new BadRequestException('Unsupported checkout return');
    const body = parse(
      z
        .object({
          paymentID: z.string().max(200).optional(),
          tran_id: z.string().max(100).optional(),
          val_id: z.string().max(200).optional(),
        })
        .passthrough(),
      input || {},
    );
    const reference = provider === 'bkash' ? body.paymentID : body.tran_id;
    if (!reference) throw new BadRequestException('A payment reference is required');
    const p = await this.db.payment.findUnique({ where: { providerRef: reference } });
    if (!p || p.provider !== provider)
      throw new BadRequestException('Checkout reference not found');
    return this.reconcile.sync(p.id, body.val_id, provider === 'bkash');
  }
  @Get('return/:provider') async get(
    @Param('provider') provider: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    await this.verify(provider, query);
    res.redirect(303, `${process.env.APP_URL}/billing?checkout=returned`);
  }
  @Post('return/:provider') async post(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    await this.verify(provider, body);
    res.redirect(303, `${process.env.APP_URL}/billing?checkout=returned`);
  }
  @Post('ipn/sslcommerz') async ipn(@Body() body: unknown) {
    const result = await this.verify('sslcommerz', body);
    return { received: true, ...result };
  }
}
