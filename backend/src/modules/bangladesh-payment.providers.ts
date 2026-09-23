import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  PaymentProvider,
  PaymentContext,
  ProviderReceipt,
  RefundResult,
} from './payment.providers';
function safeCheckout(value: unknown, domains: string[]) {
  const url = new URL(String(value));
  if (
    url.protocol !== 'https:' ||
    !domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))
  )
    throw new BadRequestException('Provider returned an invalid checkout URL');
  return url.toString();
}
const amount = (minor: number) => (minor / 100).toFixed(2);
const minor = (value: unknown) => Math.round(Number(value) * 100);
async function json(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new BadRequestException('Payment provider could not complete this request');
  return response.json();
}
export class BkashPaymentProvider implements PaymentProvider {
  private base = (
    process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
  ).replace(/\/$/, '');
  private async token() {
    const result = await json(`${this.base}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        username: process.env.BKASH_USERNAME!,
        password: process.env.BKASH_PASSWORD!,
      },
      body: JSON.stringify({
        app_key: process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET,
      }),
    });
    if (!result.id_token) throw new BadRequestException('bKash authentication was rejected');
    return result.id_token as string;
  }
  private async request(path: string, body: Record<string, unknown>) {
    return json(`${this.base}/tokenized/checkout/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await this.token(),
        'X-APP-Key': process.env.BKASH_APP_KEY!,
      },
      body: JSON.stringify(body),
    });
  }
  async createIntent(amountMinor: number, currency: string, key: string, context?: PaymentContext) {
    if (currency !== 'BDT') throw new BadRequestException('bKash accepts BDT only');
    const invoice = `CF${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    const r = await this.request('create', {
      mode: '0011',
      payerReference: context?.customerId || invoice,
      callbackURL: `${process.env.APP_URL}/api/payments/return/bkash`,
      amount: amount(amountMinor),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: invoice,
    });
    if (!r.paymentID || !r.bkashURL)
      throw new BadRequestException('bKash checkout could not be created');
    return {
      reference: String(r.paymentID),
      checkoutUrl: safeCheckout(r.bkashURL, ['bka.sh', 'bkash.com']),
    };
  }
  async verify(reference: string): Promise<ProviderReceipt> {
    const r = await this.request('payment/status', { paymentID: reference });
    return {
      reference,
      amountMinor: minor(r.amount),
      currency: String(r.currency || 'BDT'),
      paid: r.transactionStatus === 'Completed',
      transactionId: r.trxID ? String(r.trxID) : undefined,
      refundedMinor: 0,
    };
  }
  async complete(reference: string) {
    try {
      const r = await this.request('execute', { paymentID: reference });
      if (r.transactionStatus !== 'Completed' && r.statusCode !== '0000')
        return this.verify(reference);
    } catch {
      return this.verify(reference);
    }
    return this.verify(reference);
  }
  async refund(
    reference: string,
    amountMinor: number,
    key: string,
    existingRefund?: string,
  ): Promise<RefundResult> {
    const payment = await this.verify(reference);
    if (!payment.transactionId) throw new BadRequestException('bKash transaction is not settled');
    if (existingRefund) {
      const r = await this.request('payment/refund/status', {
        paymentID: reference,
        trxID: payment.transactionId,
      });
      return {
        pending: !['Completed', 'Refunded'].includes(r.transactionStatus),
        reference: existingRefund,
      };
    }
    const r = await this.request('payment/refund', {
      paymentID: reference,
      amount: amount(amountMinor),
      trxID: payment.transactionId,
      sku: key.slice(0, 50),
      reason: 'Consultation cancellation',
    });
    if (r.statusCode !== '0000') throw new BadRequestException('bKash refund request was rejected');
    return {
      pending: !['Completed', 'Refunded'].includes(r.transactionStatus),
      reference: String(r.refundTrxID || r.trxID || key),
    };
  }
  parseWebhook(): never {
    throw new BadRequestException('bKash uses server-verified checkout returns');
  }
}
export class SslCommerzPaymentProvider implements PaymentProvider {
  private base =
    process.env.SSLCOMMERZ_SANDBOX === 'false'
      ? 'https://securepay.sslcommerz.com'
      : 'https://sandbox.sslcommerz.com';
  private credentials() {
    return {
      store_id: process.env.SSLCOMMERZ_STORE_ID!,
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD!,
    };
  }
  private query(path: string, params: Record<string, string>) {
    return json(
      `${this.base}/${path}?${new URLSearchParams({ ...this.credentials(), format: 'json', ...params })}`,
    );
  }
  async createIntent(amountMinor: number, currency: string, key: string, context?: PaymentContext) {
    if (!context?.billing?.phone || !context.billing.address || !context.billing.city)
      throw new BadRequestException(
        'A billing address, city, and phone are required for SSLCommerz',
      );
    const reference = `CF${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
    const url = `${process.env.APP_URL}/api/payments/return/sslcommerz`;
    const r = await json(`${this.base}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...this.credentials(),
        total_amount: amount(amountMinor),
        currency,
        tran_id: reference,
        success_url: url,
        fail_url: url,
        cancel_url: url,
        ipn_url: `${process.env.APP_URL}/api/payments/ipn/sslcommerz`,
        cus_name: context.customerName,
        cus_email: context.email,
        cus_phone: context.billing.phone,
        cus_add1: context.billing.address,
        cus_city: context.billing.city,
        cus_country: 'Bangladesh',
        shipping_method: 'NO',
        product_name: 'Healthcare consultation',
        product_category: 'Healthcare',
        product_profile: 'non-physical-goods',
      }),
    });
    if (r.status !== 'SUCCESS' || !r.GatewayPageURL)
      throw new BadRequestException('SSLCommerz checkout could not be created');
    return { reference, checkoutUrl: safeCheckout(r.GatewayPageURL, ['sslcommerz.com']) };
  }
  async verify(reference: string, validationId?: string): Promise<ProviderReceipt> {
    const response = validationId
      ? await this.query('validator/api/validationserverAPI.php', { val_id: validationId, v: '1' })
      : await this.query('validator/api/merchantTransIDvalidationAPI.php', {
          tran_id: reference,
          v: '1',
        });
    const r = Array.isArray(response.element)
      ? response.element.find((r: Record<string, unknown>) => r.tran_id === reference) || {}
      : response;
    return {
      reference: String(r.tran_id || reference),
      amountMinor: minor(r.amount),
      currency: String(r.currency_type || r.currency || 'BDT'),
      paid: ['VALID', 'VALIDATED'].includes(r.status) && String(r.risk_level || '0') !== '1',
      transactionId: r.bank_tran_id ? String(r.bank_tran_id) : undefined,
      refundedMinor: 0,
    };
  }
  async refund(
    reference: string,
    amountMinor: number,
    key: string,
    existingRefund?: string,
  ): Promise<RefundResult> {
    if (existingRefund) {
      const r = await this.query('validator/api/merchantTransIDvalidationAPI.php', {
        refund_ref_id: existingRefund,
      });
      if (r.APIConnect !== 'DONE') throw new BadRequestException('SSLCommerz refund lookup failed');
      return { pending: r.status !== 'refunded', reference: existingRefund };
    }
    const payment = await this.verify(reference);
    if (!payment.transactionId)
      throw new BadRequestException('SSLCommerz transaction is not settled');
    const r = await this.query('validator/api/merchantTransIDvalidationAPI.php', {
      bank_tran_id: payment.transactionId,
      refund_amount: amount(amountMinor),
      refund_remarks: 'Consultation cancellation',
      refe_id: key.slice(0, 50),
      refund_trans_id: key.slice(0, 50),
      v: '1',
    });
    if (
      r.APIConnect !== 'DONE' ||
      !r.refund_ref_id ||
      !['success', 'processing'].includes(r.status)
    )
      throw new BadRequestException('SSLCommerz refund request was rejected');
    return { pending: true, reference: String(r.refund_ref_id) };
  }
  parseWebhook(): never {
    throw new BadRequestException(
      'SSLCommerz IPN must be verified through the order validation API',
    );
  }
}
