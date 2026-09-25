import { recurrenceDates } from '../src/modules/recurrence';
import { describe, it, expect } from 'vitest';
import { assertTransition, refundAmount, overlaps } from '../src/common/domain';
import { generateSlots } from '../src/modules/schedule.engine';
const rule = {
  rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  startTimeLocal: '09:00',
  endTimeLocal: '11:00',
  slotDurationMinutes: 30,
  bufferMinutes: 10,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  consultationType: 'IN_PERSON',
  feeMinor: 100000,
  roomId: null,
};
const now = new Date('2026-01-01');
describe('appointment lifecycle and cancellation policy', () => {
  it('rejects skipping check-in and reopening completed care', () => {
    expect(() => assertTransition('appointment', 'CONFIRMED', 'COMPLETED')).toThrow();
    expect(() => assertTransition('appointment', 'COMPLETED', 'IN_PROGRESS')).toThrow();
  });
  it('allows the consultation path', () => {
    for (const [a, b] of [
      ['CONFIRMED', 'CHECKED_IN'],
      ['CHECKED_IN', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'COMPLETED'],
    ])
      expect(() => assertTransition('appointment', a, b)).not.toThrow();
  });
  it('locks signed prescriptions and paid payments', () => {
    expect(() => assertTransition('prescription', 'SIGNED', 'DRAFT')).toThrow();
    expect(() => assertTransition('payment', 'SUCCEEDED', 'CREATED')).toThrow();
  });
  it('enforces waiting-room admission', () => {
    expect(() => assertTransition('telemedicine', 'SCHEDULED', 'LIVE')).toThrow();
    expect(() => assertTransition('telemedicine', 'WAITING', 'LIVE')).not.toThrow();
  });
  it.each([
    [25, 10001],
    [24, 5000],
    [2, 5000],
    [1.99, 0],
  ])('refunds the policy amount at %s hours', (hours, expected) => {
    expect(refundAmount(10001, new Date(now.getTime() + hours * 3600000), now)).toBe(expected);
  });
  it('fully refunds doctor cancellations inside two hours', () =>
    expect(refundAmount(10000, now, now, true)).toBe(10000));
  it('treats adjacent appointments as nonoverlapping', () =>
    expect(
      overlaps(
        { startAt: new Date(0), endAt: new Date(100) },
        { startAt: new Date(100), endAt: new Date(200) },
      ),
    ).toBe(false));
});
describe('virtual recurring schedule expansion', () => {
  it('uses local weekdays and buffer minutes', () => {
    const slots = generateSlots([rule], [], [], '2026-08-03', '2026-08-04', 'Asia/Dhaka', now);
    expect(slots).toHaveLength(3);
    expect(slots[0].startAt.toISOString()).toBe('2026-08-03T03:00:00.000Z');
    expect(slots[1].startAt.toISOString()).toBe('2026-08-03T03:40:00.000Z');
  });
  it('removes a day-off date', () =>
    expect(
      generateSlots(
        [rule],
        [
          {
            dateLocal: new Date('2026-08-03'),
            type: 'DAY_OFF',
            startTimeLocal: null,
            endTimeLocal: null,
          },
        ],
        [],
        '2026-08-03',
        '2026-08-03',
        'Asia/Dhaka',
        now,
      ),
    ).toHaveLength(0));
  it('overrides hours and applies block exceptions', () => {
    const ex = [
      {
        dateLocal: new Date('2026-08-03'),
        type: 'CUSTOM_HOURS',
        startTimeLocal: '14:00',
        endTimeLocal: '16:00',
      },
      {
        dateLocal: new Date('2026-08-03'),
        type: 'BLOCK',
        startTimeLocal: '14:00',
        endTimeLocal: '14:30',
      },
    ];
    expect(
      generateSlots([rule], ex, [], '2026-08-03', '2026-08-03', 'Asia/Dhaka', now),
    ).toHaveLength(2);
  });
  it('marks cross-clinic busy windows unavailable', () => {
    const slots = generateSlots(
      [rule],
      [],
      [{ startAt: new Date('2026-08-03T03:15:00Z'), endAt: new Date('2026-08-03T03:45:00Z') }],
      '2026-08-03',
      '2026-08-03',
      'Asia/Dhaka',
      now,
    );
    expect(slots.map((s) => s.available)).toEqual([false, false, true]);
  });
  it('handles DST using clinic-local wall clock time', () => {
    const slots = generateSlots(
      [
        {
          ...rule,
          rrule: 'FREQ=WEEKLY;BYDAY=SU',
          startTimeLocal: '09:00',
          endTimeLocal: '10:00',
          bufferMinutes: 0,
        },
      ],
      [],
      [],
      '2026-03-01',
      '2026-03-08',
      'America/New_York',
      now,
    );
    expect(slots[0].startAt.toISOString()).toBe('2026-03-01T14:00:00.000Z');
    expect(slots[2].startAt.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
  it('omits past slots and guards invalid duration', () => {
    expect(
      generateSlots(
        [{ ...rule, slotDurationMinutes: 0 }],
        [],
        [],
        '2026-08-03',
        '2026-08-03',
        'Asia/Dhaka',
        now,
      ),
    ).toEqual([]);
    expect(
      generateSlots(
        [rule],
        [],
        [],
        '2026-08-03',
        '2026-08-03',
        'Asia/Dhaka',
        new Date('2026-08-04'),
      ),
    ).toEqual([]);
  });
});

describe('advanced recurrence', () => {
  it('anchors alternate weeks instead of matching every weekday', () => {
    expect([
      ...recurrenceDates(
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        new Date('2026-08-03T00:00:00Z'),
        '2026-08-01',
        '2026-08-31',
        'Asia/Dhaka',
      ),
    ]).toEqual(['2026-08-03', '2026-08-17', '2026-08-31']);
  });
  it('supports a monthly ordinal weekday', () => {
    expect([
      ...recurrenceDates(
        'FREQ=MONTHLY;BYDAY=1MO',
        new Date('2026-08-01'),
        '2026-08-01',
        '2026-09-30',
        'Asia/Dhaka',
      ),
    ]).toEqual(['2026-08-03', '2026-09-07']);
  });
  it('custom hours open an otherwise non-recurring day and never restore archived rules', () => {
    const exceptions = [
      {
        dateLocal: new Date('2026-08-04'),
        type: 'CUSTOM_HOURS',
        startTimeLocal: '14:00',
        endTimeLocal: '15:00',
      },
    ];
    expect(
      generateSlots([rule], exceptions, [], '2026-08-04', '2026-08-04', 'Asia/Dhaka', now),
    ).toHaveLength(1);
    expect(
      generateSlots(
        [{ ...rule, active: false }],
        exceptions,
        [],
        '2026-08-04',
        '2026-08-04',
        'Asia/Dhaka',
        now,
      ),
    ).toHaveLength(0);
  });
});
