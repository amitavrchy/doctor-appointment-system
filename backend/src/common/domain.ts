import { ConflictException } from '@nestjs/common';
export const activeStatuses = ['HELD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS'] as const;
export const transitions: Record<string, Record<string, string[]>> = {
  appointment: {HELD:['PENDING_PAYMENT','CONFIRMED','CANCELLED'],PENDING_PAYMENT:['CONFIRMED','CANCELLED'],CONFIRMED:['CHECKED_IN','CANCELLED','NO_SHOW','RESCHEDULED'],CHECKED_IN:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[],NO_SHOW:[],RESCHEDULED:[]},
  prescription: {DRAFT:['SIGNED'],SIGNED:['DISPENSED_EXTERNAL','REVOKED','EXPIRED'],DISPENSED_EXTERNAL:[],REVOKED:[],EXPIRED:[]},
  payment: {CREATED:['REQUIRES_ACTION','SUCCEEDED','FAILED','CANCELLED'],REQUIRES_ACTION:['SUCCEEDED','FAILED','CANCELLED'],SUCCEEDED:['REFUND_PENDING'],REFUND_PENDING:['REFUNDED'],FAILED:[],CANCELLED:[],REFUNDED:[]},
  telemedicine: {SCHEDULED:['WAITING','CANCELLED'],WAITING:['LIVE','CANCELLED'],LIVE:['ENDED'],ENDED:[],CANCELLED:[]}
};
export function assertTransition(machine: string, from: string, to: string) {
  if (!transitions[machine]?.[from]?.includes(to)) throw new ConflictException(`Cannot change ${from} to ${to}`);
}
export function refundAmount(fee: number, startAt: Date, now = new Date(), doctorCancelled = false) {
  const hours = (startAt.getTime() - now.getTime()) / 3600000;
  return doctorCancelled || hours > 24 ? fee : hours >= 2 ? Math.floor(fee / 2) : 0;
}
export function overlaps(a: {startAt: Date; endAt: Date}, b: {startAt: Date; endAt: Date}) {
  return a.startAt < b.endAt && a.endAt > b.startAt;
}
