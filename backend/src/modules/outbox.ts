import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
export async function notify(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
  body: string,
  clinicId?: string,
) {
  const preference = await tx.notificationPreference.findUnique({ where: { userId } }),
    notificationId = randomUUID();
  if (preference?.inApp !== false)
    await tx.notification.create({ data: { id: notificationId, userId, title, body } });
  await tx.outboxEvent.create({
    data: {
      type: 'NOTIFICATION',
      aggregateId: notificationId,
      userId,
      clinicId,
      payload: { title, body },
    },
  });
}
