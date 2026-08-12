import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
export const id = z.string().min(1).max(100);
export const iso = z.iso.datetime({offset:true});
export const kind = z.enum(['IN_PERSON','TELEMEDICINE']);
export const soapSchema = z.object({subjective:z.string().max(10000),objective:z.string().max(10000),assessment:z.string().max(10000),plan:z.string().max(10000)});
