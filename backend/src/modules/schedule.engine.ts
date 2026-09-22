import { DateTime } from 'luxon';
import { overlaps } from '../common/domain';
type Rule = {
  rrule: string;
  startTimeLocal: string;
  endTimeLocal: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  consultationType: string;
  feeMinor: number;
  roomId: string | null;
};
type Exception = {
  dateLocal: Date;
  type: string;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
};
export type Slot = {
  startAt: Date;
  endAt: Date;
  type: string;
  feeMinor: number;
  roomId: string | null;
  available: boolean;
};
const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export function generateSlots(
  rules: Rule[],
  exceptions: Exception[],
  busy: { startAt: Date; endAt: Date }[],
  from: string,
  to: string,
  zone: string,
  now = new Date(),
): Slot[] {
  const output: Slot[] = [];
  for (
    let date = DateTime.fromISO(from, { zone }).startOf('day'),
      end = DateTime.fromISO(to, { zone }).startOf('day');
    date <= end;
    date = date.plus({ days: 1 })
  ) {
    const ex = exceptions.filter(
      (e) => e.dateLocal.toISOString().slice(0, 10) === date.toISODate(),
    );
    if (ex.some((e) => e.type === 'DAY_OFF')) continue;
    const local = (time: string) => DateTime.fromISO(`${date.toISODate()}T${time}`, { zone });
    for (const rule of rules) {
      if (
        date.endOf('day').toJSDate() < rule.effectiveFrom ||
        (rule.effectiveTo && date.toJSDate() > rule.effectiveTo)
      )
        continue;
      const byday = rule.rrule.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(',') || [];
      if (!byday.includes(days[date.weekday - 1])) continue;
      const custom = ex.find((e) => e.type === 'CUSTOM_HOURS');
      const start = local(custom?.startTimeLocal || rule.startTimeLocal),
        endTime = local(custom?.endTimeLocal || rule.endTimeLocal);
      if (
        !start.isValid ||
        !endTime.isValid ||
        rule.slotDurationMinutes <= 0 ||
        rule.bufferMinutes < 0
      )
        continue;
      for (
        let t = start;
        t.plus({ minutes: rule.slotDurationMinutes }) <= endTime;
        t = t.plus({ minutes: rule.slotDurationMinutes + rule.bufferMinutes })
      ) {
        const candidate = {
          startAt: t.toJSDate(),
          endAt: t.plus({ minutes: rule.slotDurationMinutes }).toJSDate(),
        };
        if (
          candidate.startAt <= now ||
          ex.some(
            (e) =>
              e.type === 'BLOCK' &&
              e.startTimeLocal &&
              e.endTimeLocal &&
              overlaps(candidate, {
                startAt: local(e.startTimeLocal).toJSDate(),
                endAt: local(e.endTimeLocal).toJSDate(),
              }),
          )
        )
          continue;
        if (
          output.some(
            (s) =>
              s.startAt.getTime() === candidate.startAt.getTime() &&
              s.type === rule.consultationType,
          )
        )
          continue;
        output.push({
          ...candidate,
          type: rule.consultationType,
          feeMinor: rule.feeMinor,
          roomId: rule.roomId,
          available: !busy.some((b) => overlaps(candidate, b)),
        });
      }
    }
  }
  return output.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
