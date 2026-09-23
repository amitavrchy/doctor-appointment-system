'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  Users,
  Clock3,
  CheckCircle2,
  ArrowUpRight,
  Activity,
  DoorOpen,
  AlertCircle,
  CalendarRange,
} from 'lucide-react';
import { api, dateLabel, timeLabel } from '@/lib/api';
import type { User, Appointment, Clinic } from '@/lib/types';
import { PageHeading, Avatar, Badge, Loading, ErrorState, Empty } from '../ui';
type QueueVisit = Appointment & {
  queueNumber: number;
  checkedInAt: string;
  startedAt: string | null;
};
export function StaffDashboard({ user, clinicId }: { user: User; clinicId: string }) {
  const visits = useQuery({
      queryKey: ['appointments', clinicId],
      queryFn: () => api<Appointment[]>(`/appointments?clinicId=${clinicId}`),
      refetchInterval: 15000,
    }),
    queue = useQuery({
      queryKey: ['queue', clinicId, ''],
      queryFn: () =>
        api<{
          waiting: QueueVisit[];
          live: QueueVisit[];
          completed: QueueVisit[];
          averageWaitMinutes: number;
        }>(`/queue/clinic/${clinicId}`),
      enabled: !!clinicId,
      refetchInterval: 10000,
    }),
    clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') });
  const clinician = user.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR'),
    manager =
      user.globalRole === 'SUPER_ADMIN' ||
      user.roles.some((r) => r.clinicId === clinicId && r.role === 'CLINIC_ADMIN');
  const conflicts = useQuery({
    queryKey: ['schedule-conflicts', clinicId],
    queryFn: () => api<{ id: string }[]>(`/schedules/conflicts?clinicId=${clinicId}`),
    enabled: !!clinicId && (clinician || manager),
  });
  if (visits.isPending) return <Loading />;
  if (visits.error) return <ErrorState error={visits.error} retry={() => void visits.refetch()} />;
  const clinic = clinics.data?.find((c) => c.id === clinicId),
    zone = clinic?.timezone || 'Asia/Dhaka',
    dayKey = (value: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value)),
    today = dayKey(new Date().toISOString()),
    todayVisits = visits.data.filter((a) => dayKey(a.startAt) === today),
    active = todayVisits
      .filter((a) => !['CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'COMPLETED'].includes(a.status))
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    waiting = queue.data?.waiting || [],
    live = queue.data?.live || [],
    completed = queue.data?.completed || [];
  const week = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - (6 - index) * 86400000).toISOString(),
        key = dayKey(date);
      return {
        date,
        count: visits.data.filter(
          (a) => dayKey(a.startAt) === key && !['CANCELLED', 'RESCHEDULED'].includes(a.status),
        ).length,
      };
    }),
    max = Math.max(1, ...week.map((d) => d.count)),
    first = user.fullName.replace(/^Dr\.\s*/, '').split(' ')[0],
    next = live.find((a) => a.doctorId === user.id) || active[0];
  return (
    <>
      <PageHeading
        eyebrow={clinic?.name || 'Clinic operations'}
        title={`Good to see you, ${first}.`}
        description={
          clinician
            ? 'Your patients, consultations, and the next steps in their care.'
            : 'Your clinic’s day, connected from arrival to follow-up.'
        }
        action={
          <div className="row-actions">
            <Link href="/calendar" className="button secondary">
              <CalendarRange size={17} />
              Open calendar
            </Link>
            <Link href="/queue" className="button primary">
              <Users size={17} />
              Live patient queue
            </Link>
          </div>
        }
      />
      <div className="staff-summary-banner">
        <div>
          <span className="live-indicator">
            <i />
            Clinic command center
          </span>
          <h2>
            {waiting.length
              ? `${waiting.length} patient${waiting.length === 1 ? ' is' : 's are'} waiting for care.`
              : live.length
                ? 'Care is in progress. Your team is connected.'
                : 'A clear view. A little more room to care.'}
          </h2>
          <p>
            {todayVisits.length} scheduled visits today · {live.length} in consultation ·{' '}
            {completed.length} completed
          </p>
        </div>
        <div className="staff-day">
          <strong>{dateLabel(new Date().toISOString(), { day: 'numeric' })}</strong>
          <span>{dateLabel(new Date().toISOString(), { weekday: 'long', month: 'long' })}</span>
        </div>
      </div>
      <div className="stats">
        {[
          [CalendarDays, 'Scheduled today', todayVisits.length],
          [Users, 'Waiting room', waiting.length],
          [Activity, 'In consultation', live.length],
          [Clock3, 'Average wait', `${(queue.data?.averageWaitMinutes || 0).toFixed(0)} min`],
        ].map(([Icon, label, value]) => {
          const I = Icon as typeof CalendarDays;
          return (
            <div className="stat" key={String(label)}>
              <div className="stat-top">
                {String(label)}
                <span className="stat-icon">
                  <I size={18} />
                </span>
              </div>
              <div className="stat-value">{String(value)}</div>
              <p className="small">
                {label === 'Average wait' ? 'Check-in to consultation start' : 'Current clinic day'}
              </p>
            </div>
          );
        })}
      </div>
      <div className="staff-main-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Today’s patient visits</h2>
                <p>Arrivals and upcoming consultations, in order.</p>
              </div>
              <Link href="/appointments?tab=today" className="text-link">
                Manage visits ↗
              </Link>
            </div>
            {active.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Scheduled</th>
                      <th>Doctor</th>
                      <th>Visit status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {active.slice(0, 6).map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="person-cell">
                            <Avatar name={a.patient.fullName} color={a.doctor.color} />
                            <div>
                              <strong>{a.patient.fullName}</strong>
                              <small>
                                {a.type === 'TELEMEDICINE'
                                  ? 'Online consultation'
                                  : 'In-person visit'}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>{timeLabel(a.startAt)}</strong>
                        </td>
                        <td>
                          <span className="small">{a.doctor.user.fullName}</span>
                        </td>
                        <td>
                          <Badge status={a.status} />
                        </td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Manage visit for ${a.patient.fullName}`}
                            href={`/appointments?appointment=${a.id}`}
                          >
                            <ArrowUpRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="A little breathing room today"
                body="Scheduled visits and newly checked-in patients appear here."
                action={{ href: '/calendar', label: 'Open clinic calendar' }}
              />
            )}
          </section>
          <section className="panel padded">
            <div className="section-row" style={{ marginTop: 0 }}>
              <div>
                <h2>A week of connected care</h2>
                <p className="small" style={{ marginTop: 6 }}>
                  Scheduled visits, excluding cancelled and replaced visits.
                </p>
              </div>
              <span className="tag">Last 7 days</span>
            </div>
            <div
              className="bar-chart"
              role="img"
              aria-label={week
                .map((d) => `${dayKey(d.date)}: ${d.count} scheduled visits`)
                .join('; ')}
            >
              {week.map((d) => (
                <div className="bar-group" key={d.date}>
                  <strong>{d.count}</strong>
                  <div className="bar" style={{ height: `${(d.count / max) * 150}px` }} />
                  <span>{dateLabel(d.date, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>
                {next?.status === 'IN_PROGRESS' ? 'Current consultation' : 'Next in your day'}
              </h2>
              <Activity size={19} color="#0d776e" />
            </div>
            {next ? (
              <div className="staff-next">
                <div className="person-cell">
                  <Avatar name={next.patient.fullName} large color={next.doctor.color} />
                  <div>
                    <h3>{next.patient.fullName}</h3>
                    <p>{next.doctor.user.fullName}</p>
                    <Badge status={next.status} />
                  </div>
                </div>
                <div className="detail-line">
                  <CalendarDays size={17} />
                  {dateLabel(next.startAt)} · {timeLabel(next.startAt)}
                </div>
                <p className="small" style={{ marginTop: 10 }}>
                  {next.reason || 'No visit reason provided'}
                </p>
                <Link
                  href={`/appointments?appointment=${next.id}`}
                  className="button primary full"
                  style={{ marginTop: 22 }}
                >
                  Open visit workspace
                  <ArrowUpRight size={17} />
                </Link>
              </div>
            ) : (
              <div className="staff-next">
                <p className="small">Your next scheduled visit will appear here.</p>
              </div>
            )}
          </section>
          <section className="panel padded">
            <div className="section-row" style={{ marginTop: 0 }}>
              <h2>Waiting room</h2>
              <span className="tag">{waiting.length}</span>
            </div>
            {waiting.slice(0, 4).map((a) => (
              <Link className="waiting-peek" key={a.id} href={`/appointments?appointment=${a.id}`}>
                <span className="queue-ticket">#{String(a.queueNumber).padStart(3, '0')}</span>
                <div>
                  <strong>{a.patient.fullName}</strong>
                  <small>
                    {Math.max(
                      0,
                      Math.floor((Date.now() - new Date(a.checkedInAt).getTime()) / 60000),
                    )}{' '}
                    min since check-in
                  </small>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))}
            {!waiting.length && <p className="small">No patients are waiting right now.</p>}
            <Link
              href="/queue"
              className="text-link"
              style={{ display: 'inline-block', marginTop: 17 }}
            >
              View live queue ↗
            </Link>
          </section>
          {!!conflicts.data?.length && (
            <section className="conflict-callout">
              <AlertCircle size={23} />
              <h3>
                {conflicts.data.length} booking{conflicts.data.length === 1 ? ' needs' : 's need'} a
                review.
              </h3>
              <p>Schedule changes affected existing visits. The bookings have been retained.</p>
              <Link href="/schedules" className="button secondary full">
                Review schedule conflicts
              </Link>
            </section>
          )}
          <section className="panel padded">
            <h2>
              <DoorOpen size={19} style={{ verticalAlign: 'middle', marginRight: 7 }} />
              Consultation rooms
            </h2>
            {clinic?.rooms.slice(0, 5).map((room) => (
              <div className="room-state" key={room.id}>
                <span>{room.name}</span>
                <Badge
                  status={
                    live.some((a) => 'roomId' in a && a.roomId === room.id)
                      ? 'IN_PROGRESS'
                      : 'AVAILABLE'
                  }
                />
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
