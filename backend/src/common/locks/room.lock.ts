import { Prisma } from '@prisma/client';
// Acquire doctor locks first, then room locks, in sorted order in every workflow.
export async function lockRooms(
  tx: Prisma.TransactionClient,
  ...ids: (string | null | undefined)[]
) {
  for (const id of [...new Set(ids.filter((id): id is string => !!id))].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`room:${id}`}, 0))`;
}
