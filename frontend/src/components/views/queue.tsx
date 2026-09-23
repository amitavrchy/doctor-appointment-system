'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Clock3, Play, ArrowUpRight, Activity, CheckCircle2, Search } from 'lucide-react';
import Link from 'next/link';
import { api, post, timeLabel } from '@/lib/api';
import type { Appointment, User, Doctor } from '@/lib/types';
import { PageHeading, Avatar, Badge, Loading, ErrorState, Empty } from '../ui';
import { useToast } from '../providers';
type Queued = Appointment & {
  queueNumber: number;
  priority: number;
  checkedInAt: string;
  startedAt: string | null;
  completedAt: string | null;
};
type QueueData = {
  date: string;
  waiting: Queued[];
  live: Queued[];
  completed: Queued[];
  averageWaitMinutes: number;
  longestWaitMinutes: number;
};
export function ClinicQueue({ user, clinicId }: { user: User; clinicId: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [doctorId, setDoctorId] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['queue', clinicId, doctorId],
    queryFn: () =>
      api<QueueData>(`/queue/clinic/${clinicId}${doctorId ? `?doctorId=${doctorId}` : ''}`),
    refetchInterval: 10000,
    enabled: !!clinicId,
  });
  const doctors = useQuery({
    queryKey: ['doctors', clinicId],
    queryFn: () => api<Doctor[]>(`/doctors?clinicId=${clinicId}`),
  });
  const ownDoctor = user.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR');
  const canTriage =
    ownDoctor ||
    user.globalRole === 'SUPER_ADMIN' ||
    user.roles.some((r) => r.clinicId === clinicId && ['NURSE', 'CLINIC_ADMIN'].includes(r.role));
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const q = query.data;
  const filter = (a: Queued) =>
    `${a.patient.fullName} ${a.doctor.user.fullName} ${a.queueNumber}`
      .toLowerCase()
      .includes(search.toLowerCase());
  async function callNext() {
    setBusy(true);
    try {
      await post('/queue/call-next', { clinicId, doctorId: user.id });
      await client.invalidateQueries({ queryKey: ['queue'] });
      void client.invalidateQueries({ queryKey: ['appointments'] });
      toast('Your next patient has been called.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Clinic command center"
        title="A smoother day of care."
        description="A live view of arrivals, consultations, and completed visits. Queue updates every 10 seconds."
        action={
          ownDoctor ? (
            <button className="button primary" disabled={busy} onClick={callNext}>
              <Play size={17} />
              {busy ? 'Calling…' : 'Call next patient'}
            </button>
          ) : (
            <Link href="/appointments?tab=today" className="button primary">
              Check in a patient
              <ArrowUpRight size={17} />
            </Link>
          )
        }
      />
      <div className="stats">
        {[
          [Users, 'Waiting', q.waiting.length],
          [Activity, 'In consultation', q.live.length],
          [CheckCircle2, 'Completed today', q.completed.length],
          [Clock3, 'Average waiting time', `${q.averageWaitMinutes.toFixed(0)} min`],
        ].map(([Icon, label, value]) => {
          const I = Icon as typeof Users;
          return (
            <div className="stat" key={String(label)}>
              <div className="stat-top">
                {String(label)}
                <span className="stat-icon">
                  <I size={19} />
                </span>
              </div>
              <div className="stat-value">{String(value)}</div>
              <p className="small">
                {label === 'Waiting'
                  ? `Longest wait ${q.longestWaitMinutes.toFixed(0)} min`
                  : q.date}
              </p>
            </div>
          );
        })}
      </div>
      <div className="filters">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search clinic queue"
            placeholder="Patient, doctor, or queue number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Queue doctor"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
        >
          <option value="">All permitted doctors</option>
          {doctors.data?.map((d) => (
            <option key={d.userId} value={d.userId}>
              {d.user.fullName}
            </option>
          ))}
        </select>
        <span className="live-indicator">
          <i />
          Live clinic queue
        </span>
      </div>
      <div className="queue-board">
        {[
          ['waiting', 'Waiting room', q.waiting],
          ['live', 'In consultation', q.live],
          ['completed', 'Completed', q.completed],
        ].map(([key, title, entries]) => (
          <section className={`queue-column ${String(key)}`} key={String(key)}>
            <div className="queue-column-head">
              <h2>{String(title)}</h2>
              <span className="tag">{(entries as Queued[]).length}</span>
            </div>
            {(entries as Queued[]).filter(filter).map((a, index) => (
              <article className="queue-card" key={a.id}>
                <div className="queue-card-top">
                  <span className="queue-ticket">#{String(a.queueNumber).padStart(3, '0')}</span>
                  {a.priority > 0 && (
                    <span className={`priority priority-${a.priority}`}>
                      {a.priority === 2 ? 'Urgent' : 'Priority'}
                    </span>
                  )}
                  <small>
                    {String(key) === 'waiting'
                      ? `${Math.max(0, Math.floor((Date.now() - new Date(a.checkedInAt).getTime()) / 60000))} min waiting`
                      : timeLabel(a.startedAt || a.startAt)}
                  </small>
                </div>
                <div className="person-cell">
                  <Avatar name={a.patient.fullName} color={a.doctor.color} />
                  <div>
                    <h3>{a.patient.fullName}</h3>
                    <p>{a.doctor.user.fullName}</p>
                  </div>
                </div>
                <div className="queue-card-meta">
                  <span>{timeLabel(a.startAt)} scheduled</span>
                  <span>{a.type === 'TELEMEDICINE' ? 'Online' : 'In person'}</span>
                </div>
                {String(key) === 'waiting' && canTriage && (
                  <label className="queue-priority">
                    Priority
                    <select
                      aria-label={`Priority for ${a.patient.fullName}`}
                      value={a.priority}
                      onChange={async (e) => {
                        try {
                          await api(`/queue/${a.id}/priority`, {
                            method: 'PATCH',
                            body: JSON.stringify({ priority: Number(e.target.value) }),
                          });
                          void query.refetch();
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    >
                      <option value={0}>Routine</option>
                      <option value={1}>Priority</option>
                      <option value={2}>Urgent</option>
                    </select>
                  </label>
                )}
                <Link href={`/appointments?appointment=${a.id}`} className="button secondary full">
                  {String(key) === 'live' ? 'Open consultation' : 'View visit'}
                  <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
            {!(entries as Queued[]).length && (
              <div className="queue-empty">
                <CheckCircle2 size={26} />
                <p>
                  {String(key) === 'waiting'
                    ? 'All caught up. Checked-in patients appear here.'
                    : String(key) === 'live'
                      ? 'No consultation is in progress.'
                      : 'Completed visits will appear here.'}
                </p>
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
