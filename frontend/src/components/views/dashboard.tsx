'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarDays,
  Heart,
  HeartPulse,
  FileText,
  Clock3,
  MapPin,
  Video,
  ShieldCheck,
  Leaf,
  Stethoscope,
} from 'lucide-react';
import { api, dateLabel, timeLabel } from '@/lib/api';
import type { Appointment, Doctor, User } from '@/lib/types';
import { Avatar, Badge, Empty, ErrorState, Loading, PageHeading } from '../ui';
export function Dashboard({ user, clinicId }: { user: User; clinicId?: string }) {
  const appointments = useQuery({
    queryKey: ['appointments', clinicId],
    queryFn: () => api<Appointment[]>(`/appointments${clinicId ? `?clinicId=${clinicId}` : ''}`),
  });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
  if (appointments.isPending) return <Loading />;
  if (appointments.error)
    return <ErrorState error={appointments.error} retry={() => void appointments.refetch()} />;
  const all = appointments.data || [],
    upcoming = all
      .filter(
        (a) =>
          new Date(a.startAt) > new Date() &&
          !['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(a.status),
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    next = upcoming[0],
    completed = all.filter((a) => a.status === 'COMPLETED'),
    tele = upcoming.filter((a) => a.type === 'TELEMEDICINE');
  const first = user.fullName.replace(/^Dr\.\s*/, '').split(' ')[0];
  return (
    <>
      <PageHeading
        title={`Good to see you, ${first} 👋`}
        description="Here’s what’s happening with your care today."
        action={
          <Link className="button primary" href="/doctors">
            <CalendarDays size={17} />
            Book an appointment
          </Link>
        }
      />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A little care goes a long way</p>
          <h2>
            Your health deserves
            <br />a place on your calendar.
          </h2>
          <p>
            Stay on top of your wellbeing. Find the right doctor and make a little time for
            yourself.
          </p>
          <Link href="/doctors" className="button primary small">
            Find your doctor <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-circle">
            <HeartPulse size={97} strokeWidth={1.2} className="hero-heart" />
          </div>
          <span className="art-pill one">
            <ShieldCheck size={17} />
            You’re in good hands
          </span>
          <span className="art-pill two">
            <Heart size={15} />A healthier everyday
          </span>
        </div>
      </section>
      <div className="stats">
        {[
          {
            label: 'Upcoming visits',
            value: String(upcoming.length).padStart(2, '0'),
            foot: next
              ? `Next on ${dateLabel(next.startAt, { day: 'numeric', month: 'short' })}`
              : 'Your calendar is clear',
            Icon: CalendarDays,
          },
          {
            label: 'Completed visits',
            value: String(completed.length).padStart(2, '0'),
            foot: 'A step toward feeling better',
            Icon: ShieldCheck,
          },
          {
            label: 'Care records',
            value: String(completed.length).padStart(2, '0'),
            foot: 'Your health story, together',
            Icon: FileText,
          },
          {
            label: 'Online consultations',
            value: String(tele.length).padStart(2, '0'),
            foot: 'Care from wherever you are',
            Icon: Video,
          },
        ].map(({ label, value, foot, Icon }) => (
          <div className="stat" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon">
                <Icon size={18} strokeWidth={1.6} />
              </span>
            </div>
            <div className="stat-value">{value}</div>
            <p className="stat-footer">{foot}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Your appointments</h2>
              <p>A little look at what’s coming up.</p>
            </div>
            <Link className="text-link" href="/appointments">
              View all ↗
            </Link>
          </div>
          <div className="tabs">
            <span className="tab active">
              Upcoming{' '}
              <span className="tag" style={{ marginLeft: 7 }}>
                {upcoming.length}
              </span>
            </span>
            <Link className="tab" href="/appointments?tab=past">
              Past appointments
            </Link>
          </div>
          {upcoming.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Date & time</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {upcoming.slice(0, 4).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="person-cell">
                          <Avatar name={a.doctor.user.fullName} color={a.doctor.color} />
                          <div>
                            <strong>{a.doctor.user.fullName}</strong>
                            <small>{a.doctor.specialties[0]}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{dateLabel(a.startAt, { day: 'numeric', month: 'short' })}</strong>
                        <small>{timeLabel(a.startAt)}</small>
                      </td>
                      <td>
                        <Badge status={a.status} />
                      </td>
                      <td>
                        <Link
                          href="/appointments"
                          className="icon-button"
                          aria-label={`View appointment with ${a.doctor.user.fullName}`}
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
              title="Make a little time for yourself"
              body="Your next appointment will appear here."
              action={{ href: '/doctors', label: 'Find a doctor' }}
            />
          )}
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Your next visit</h2>
              <Clock3 size={18} color="#789287" />
            </div>
            {next ? (
              <div className="next-card">
                <div className="next-date">
                  <div className="date-tile">
                    <span>{dateLabel(next.startAt, { month: 'short' })}</span>
                    <strong>{dateLabel(next.startAt, { day: 'numeric' })}</strong>
                  </div>
                  <div>
                    <h3>{dateLabel(next.startAt, { weekday: 'long' })}</h3>
                    <small>
                      {timeLabel(next.startAt)} – {timeLabel(next.endAt)}
                    </small>
                  </div>
                </div>
                <div className="person-cell">
                  <Avatar name={next.doctor.user.fullName} color={next.doctor.color} />
                  <div>
                    <h3>{next.doctor.user.fullName}</h3>
                    <small>{next.doctor.specialties[0]}</small>
                  </div>
                </div>
                <p className="detail-line">
                  <MapPin size={16} />
                  {next.clinic.name}
                </p>
                <p className="detail-line">
                  {next.type === 'TELEMEDICINE' ? <Video size={16} /> : <Stethoscope size={16} />}{' '}
                  {next.type === 'TELEMEDICINE' ? 'Online consultation' : 'In-person consultation'}
                </p>
                <Link
                  href={next.type === 'TELEMEDICINE' ? '/telemedicine' : '/appointments'}
                  className="button secondary"
                >
                  View appointment <ArrowUpRight size={16} />
                </Link>
              </div>
            ) : (
              <Empty
                title="A little breathing room"
                body="No upcoming visits. Book whenever you’re ready."
              />
            )}
          </section>
          <aside className="wellness">
            <span className="wellness-icon">
              <Leaf size={22} strokeWidth={1.4} />
            </span>
            <h3>Take a moment for you.</h3>
            <p>
              A short walk, a glass of water, a slower breath. Small habits can make room for a
              better day.
            </p>
          </aside>
        </div>
      </div>
      <div className="section-row">
        <h2>Find your care team</h2>
        <Link className="text-link" href="/doctors">
          Explore doctors ↗
        </Link>
      </div>
      <div className="doctor-grid compact">
        {doctors.data?.slice(0, 3).map((d) => (
          <article className="doctor-card" key={d.userId}>
            <div className="doctor-top">
              <Avatar large name={d.user.fullName} color={d.color} />
              <span className="tag">{d.languages.join(' · ')}</span>
            </div>
            <h3>{d.user.fullName}</h3>
            <p className="specialty">{d.specialties[0]}</p>
            <div className="detail-line">
              <MapPin size={15} />
              {d.memberships.length} clinic locations
            </div>
            <Link href={`/doctors?doctor=${d.userId}`} className="button secondary full">
              View availability <ArrowUpRight size={16} />
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
