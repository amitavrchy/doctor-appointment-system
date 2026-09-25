import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  BkashPaymentProvider,
  SslCommerzPaymentProvider,
} from '../src/modules/bangladesh-payment.providers';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const response = (value: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
describe('Bangladesh payment adapter transport contracts', () => {
  it('creates a bKash checkout with exact minor-unit conversion and a bounded return URL', async () => {
    vi.stubEnv('APP_URL', 'https://careflow.example');
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => response({ id_token: 'synthetic-token' }))
      .mockImplementationOnce(() =>
        response({ paymentID: 'payment-1', bkashURL: 'https://sandbox.payment.bka.sh/checkout' }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await new BkashPaymentProvider().createIntent(120099, 'BDT', 'booking-key');
    expect(result.reference).toBe('payment-1');
    const payload = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(payload.amount).toBe('1200.99');
    expect(payload.callbackURL).toBe('https://careflow.example/api/payments/return/bkash');
  });
  it('rejects checkout redirects outside the provider domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => response({ id_token: 'synthetic-token' }))
        .mockImplementationOnce(() =>
          response({
            paymentID: 'payment-1',
            bkashURL: 'https://bka.sh.attacker.example/checkout',
          }),
        ),
    );
    await expect(new BkashPaymentProvider().createIntent(100, 'BDT', 'key')).rejects.toThrow(
      'invalid checkout',
    );
  });
  it('SSLCommerz verification rejects risky receipts and preserves receipt identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        response({
          tran_id: 'actual-reference',
          status: 'VALID',
          amount: '1234.56',
          currency_type: 'BDT',
          risk_level: '1',
          bank_tran_id: 'bank-1',
        }),
      ),
    );
    const result = await new SslCommerzPaymentProvider().verify(
      'expected-reference',
      'validation-1',
    );
    expect(result).toMatchObject({
      reference: 'actual-reference',
      paid: false,
      amountMinor: 123456,
      currency: 'BDT',
    });
  });
  it('SSLCommerz pending refunds are polled without submitting another refund', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => response({ APIConnect: 'DONE', status: 'processing' }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await new SslCommerzPaymentProvider().refund('payment-1', 500, 'refund-key', 'refund-ref'),
    ).toEqual({ pending: true, reference: 'refund-ref' });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('refund_ref_id')).toBe('refund-ref');
    expect(url.searchParams.has('refund_amount')).toBe(false);
  });
});
