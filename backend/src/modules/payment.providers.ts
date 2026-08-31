import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
export interface PaymentProvider {
  createIntent(amountMinor:number,currency:string,key:string):Promise<{reference:string;clientSecret?:string}>;
  refund(reference:string,amountMinor:number,key:string):Promise<void>;
  parseWebhook(raw:Buffer,signature:string):{eventId:string;reference:string;amountMinor:number;currency:string;paid:boolean};
}
export class DemoPaymentProvider implements PaymentProvider {
  async createIntent(_amount:number,_currency:string,key:string){return {reference:`demo_${key}`};}
  async refund(){return;}
  parseWebhook():never{throw new BadRequestException('Demo payments use the authenticated settlement route');}
}
export class StripePaymentProvider implements PaymentProvider {
  private async request(path:string,params:Record<string,string>,key:string){const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key},body:new URLSearchParams(params)});const data=await response.json();if(!response.ok)throw new BadRequestException('Payment provider request failed');return data;}
  async createIntent(amountMinor:number,currency:string,key:string){const data=await this.request('payment_intents',{amount:String(amountMinor),currency:currency.toLowerCase(),'automatic_payment_methods[enabled]':'true'},key);return {reference:data.id,clientSecret:data.client_secret};}
  async refund(reference:string,amountMinor:number,key:string){await this.request('refunds',{payment_intent:reference,amount:String(amountMinor)},key);}
  parseWebhook(raw:Buffer,signature:string){const parts=signature.split(',').map(s=>s.split('='));const timestamp=parts.find(p=>p[0]==='t')?.[1]||'';const expected=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${raw.toString('utf8')}`).digest();const signatures=parts.filter(p=>p[0]==='v1').map(p=>Buffer.from(p[1]||'','hex'));if(Math.abs(Date.now()/1000-Number(timestamp))>300||!signatures.some(s=>s.length===expected.length&&timingSafeEqual(s,expected)))throw new BadRequestException('Webhook signature rejected');const event=JSON.parse(raw.toString('utf8'));const object=event.data.object;return {eventId:event.id,reference:object.id,amountMinor:object.amount_received,currency:String(object.currency).toUpperCase(),paid:event.type==='payment_intent.succeeded'};}
}
export function paymentProvider(name:string):PaymentProvider {
  if(name==='demo'&&process.env.DEMO_MODE==='true')return new DemoPaymentProvider();
  if(name==='stripe'&&process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_WEBHOOK_SECRET)return new StripePaymentProvider();
  throw new BadRequestException(`${name} is not configured. SSLCommerz and bKash require merchant adapters.`);
}
