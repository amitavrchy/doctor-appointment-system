import { RRule } from 'rrule';
import { DateTime } from 'luxon';
export function parseRecurrence(value: string, anchor: Date, zone: string) {
  const options = RRule.parseString(value.replace(/^RRULE:/, ''));
  if (![RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY].includes(options.freq!))
    throw new Error('Use daily, weekly, or monthly recurrence');
  if ((options.interval || 1) < 1 || (options.interval || 1) > 52)
    throw new Error('Recurrence interval must be between 1 and 52');
  if (options.count && options.count > 10000) throw new Error('Recurrence count exceeds 10000');
  if (options.byhour || options.byminute || options.bysecond)
    throw new Error('Set hours in the schedule window rather than the recurrence');
  const dtstart = DateTime.fromJSDate(anchor, { zone })
    .startOf('day')
    .toUTC(0, { keepLocalTime: true })
    .toJSDate();
  return new RRule({ ...options, dtstart });
}
export function recurrenceDates(
  value: string,
  anchor: Date,
  from: string,
  to: string,
  zone: string,
): Set<string> {
  const rule = parseRecurrence(value, anchor, zone);
  return new Set(
    rule
      .between(new Date(`${from}T00:00:00Z`), new Date(`${to}T23:59:59Z`), true)
      .map((date) => date.toISOString().slice(0, 10)),
  );
}
