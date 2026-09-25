import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapping: Record<string, [number, string]> = {
        P2002: [409, 'A record with these details already exists'],
        P2025: [404, 'The requested record was not found'],
        P2003: [400, 'A related record is unavailable'],
        P2004: [409, 'This change conflicts with another active record'],
        P2034: [409, 'Another request changed this record. Please try again'],
      };
      const [status, message] = mapping[error.code] || [
        409,
        'This change conflicts with the current data',
      ];
      response.status(status).json({ statusCode: status, message });
      return;
    }
    console.error(
      `API operation failed (${error instanceof Error ? error.name : 'UnknownError'}). Request bodies and clinical content are omitted.`,
    );
    response.status(500).json({
      statusCode: 500,
      message: 'The operation could not be completed. Please try again.',
    });
  }
}
