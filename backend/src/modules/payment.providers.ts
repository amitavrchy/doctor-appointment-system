import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { BkashPaymentProvider, SslCommerzPaymentProvider } from './bangladesh-payment.providers';
export type PaymentContext = {
  customerId: string;
  customerName: string;
  email: string;
  billing?: { phone: string; address: string; city: string };
};
export type ProviderReceipt = {
  reference: string;
  amountMinor: number;
  currency: string;
  paid: boolean;
  transactionId?: string;
  refundedMinor?: number;
};
export type RefundResult = { pending: boolean; reference?: string };
export interface PaymentProvider {
  createIntent(
    amountMinor: number,
    currency: string,
    key: string,
    context?: PaymentContext,
  ): Promise<{ reference: string; clientSecret?: string; checkoutUrl?: string }>;
  refund(
    reference: string,
    amountMinor: number,
    key: string,
    existingRefund?: string,
  ): Promise<void | RefundResult>;
  verify?(reference: string, validationId?: string): Promise<ProviderReceipt>;
  parseWebhook(
    raw: Buffer,
    signature: string,
  ): { eventId: string; reference: string; amountMinor: number; currency: string; paid: boolean };
}
export class DemoPaymentProvider implements PaymentProvider {
  async createIntent(_amount: number, _currency: string, key: string) {
    return { reference: `demo_${key}` };
  }
  async refund() {
    return;
  }
  parseWebhook(): never {
    throw new BadRequestException('Demo payments use the authenticated settlement route');
  }
}
export class StripePaymentProvider implements PaymentProvider {
  private async request(path: string, params: Record<string, string>, key: string) {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': key,
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new BadRequestException('Payment provider request failed');
    return data;
  }
  async createIntent(amountMinor: number, currency: string, key: string) {
    const data = await this.request(
      'payment_intents',
      {
        amount: String(amountMinor),
        currency: currency.toLowerCase(),
        'automatic_payment_methods[enabled]': 'true',
      },
      key,
    );
    return { reference: data.id, clientSecret: data.client_secret };
  }
  async refund(reference: string, amountMinor: number, key: string, existingRefund?: string) {
    const data = existingRefund
      ? await this.read(`refunds/${encodeURIComponent(existingRefund)}`)
      : await this.request(
          'refunds',
          { payment_intent: reference, amount: String(amountMinor) },
          key,
        );
    if (data.status === 'failed' || data.status === 'canceled')
      throw new BadRequestException('Stripe refund did not complete');
    return { pending: data.status !== 'succeeded', reference: String(data.id) };
  }
  private async read(path: string) {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new BadRequestException('Stripe lookup failed');
    return response.json();
  }
  async verify(reference: string): Promise<ProviderReceipt> {
    const p = await this.read(
      `payment_intents/${encodeURIComponent(reference)}?expand[]=latest_charge`,
    );
    return {
      reference: String(p.id),
      amountMinor: Number(p.amount_received),
      currency: String(p.currency).toUpperCase(),
      paid: p.status === 'succeeded',
      transactionId: typeof p.latest_charge === 'object' ? p.latest_charge?.id : undefined,
      refundedMinor:
        typeof p.latest_charge === 'object' ? Number(p.latest_charge?.amount_refunded || 0) : 0,
    };
  }
  parseWebhook(raw: Buffer, signature: string) {
    const parts = signature.split(',').map((s) => s.split('='));
    const timestamp = parts.find((p) => p[0] === 't')?.[1] || '';
    const expected = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
      .update(`${timestamp}.${raw.toString('utf8')}`)
      .digest();
    const signatures = parts
      .filter((p) => p[0] === 'v1')
      .map((p) => Buffer.from(p[1] || '', 'hex'));
    if (
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected))
    )
      throw new BadRequestException('Webhook signature rejected');
    const event = JSON.parse(raw.toString('utf8'));
    const object = event.data.object;
    return {
      eventId: event.id,
      reference: object.id,
      amountMinor: object.amount_received,
      currency: String(object.currency).toUpperCase(),
      paid: event.type === 'payment_intent.succeeded',
    };
  }
}
export function paymentProvider(name: string): PaymentProvider {
  if (name === 'demo' && process.env.DEMO_MODE === 'true') return new DemoPaymentProvider();
  if (name === 'stripe' && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
    return new StripePaymentProvider();
  if (
    name === 'bkash' &&
    process.env.BKASH_APP_KEY &&
    process.env.BKASH_APP_SECRET &&
    process.env.BKASH_USERNAME &&
    process.env.BKASH_PASSWORD
  )
    return new BkashPaymentProvider();
  if (
    name === 'sslcommerz' &&
    process.env.SSLCOMMERZ_STORE_ID &&
    process.env.SSLCOMMERZ_STORE_PASSWORD
  )
    return new SslCommerzPaymentProvider();
  throw new BadRequestException(
    `${name} is not configured. Add its merchant credentials to the backend environment.`,
  );
}
