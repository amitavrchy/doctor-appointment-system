import { describe,it,expect } from 'vitest';
import { createHmac } from 'crypto';
import { StripePaymentProvider,DemoPaymentProvider } from '../src/modules/payment.providers';
describe('payment adapter contracts',()=>{
  it('preserves demo intent identity across retries',async()=>{const p=new DemoPaymentProvider();expect(await p.createIntent(120000,'BDT','stable-key')).toEqual(await p.createIntent(120000,'BDT','stable-key'));});
  it('verifies signed Stripe bodies and amount/currency',()=>{process.env.STRIPE_WEBHOOK_SECRET='contract-test-secret';const body=Buffer.from(JSON.stringify({id:'evt_1',type:'payment_intent.succeeded',data:{object:{id:'pi_1',amount_received:120000,currency:'bdt'}}}));const t=Math.floor(Date.now()/1000);const sig=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body.toString()}`).digest('hex');expect(new StripePaymentProvider().parseWebhook(body,`t=${t},v1=${sig}`)).toEqual({eventId:'evt_1',reference:'pi_1',amountMinor:120000,currency:'BDT',paid:true});expect(()=>new StripePaymentProvider().parseWebhook(Buffer.from('{}'),`t=${t},v1=${sig}`)).toThrow();});
  it('rejects stale and invalid signatures',()=>{const p=new StripePaymentProvider();expect(()=>p.parseWebhook(Buffer.from('{}'),'t=1,v1=1234')).toThrow();expect(()=>p.parseWebhook(Buffer.from('{}'),'')).toThrow();});
});
