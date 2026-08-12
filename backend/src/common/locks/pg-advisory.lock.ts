import { Prisma } from '@prisma/client';
// Doctor-wide, across clinics: serializes overlapping windows, not just equal starts.
// Sort keys before locking when moving an appointment between doctors.
export async function lockDoctors(tx: Prisma.TransactionClient, ...doctorIds: string[]) {
  for (const id of [...new Set(doctorIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }
}
