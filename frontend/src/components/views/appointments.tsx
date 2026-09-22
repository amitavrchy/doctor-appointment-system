'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Search, CalendarDays, MapPin, Clock3, Video, FileText } from 'lucide-react';
import { api, post, dateLabel, timeLabel, money, localDate } from '@/lib/api';
import type { Appointment, User, Doctor } from '@/lib/types';
import { Avatar, Badge, Empty, ErrorState, Loading, Modal, PageHeading } from '../ui';
import { BookingModal } from './doctors';
import { Consultation } from './records';
import { useToast } from '../providers';
import { Vitals } from '../clinical-extras';
export function Appointments({ user, clinicId }: { user: User; clinicId?: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [tab, setTab] = useState(() =>
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('tab') || 'upcoming'
        : 'upcoming',
    ),
    [search, setSearch] = useState(''),
    [detail, setDetail] = useState<Appointment | null>(null),
    [cancel, setCancel] = useState<Appointment | null>(null),
    [reason, setReason] = useState(''),
    [reschedule, setReschedule] = useState<Appointment | null>(null),
    [consult, setConsult] = useState<Appointment | null>(null),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['appointments', clinicId],
    queryFn: () => api<Appointment[]>(`/appointments${clinicId ? `?clinicId=${clinicId}` : ''}`),
    refetchInterval: 30000,
  });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const all = query.data || [],
    terminal = ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'];
  const visible = all
    .filter((a) => {
      const match =
        tab === 'upcoming'
          ? !terminal.includes(a.status) && new Date(a.endAt) > new Date()
          : tab === 'today'
            ? dateLabel(a.startAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) ===
              dateLabel(new Date().toISOString(), {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })
            : terminal.includes(a.status) || new Date(a.endAt) <= new Date();
      return (
        match &&
        `${a.doctor.user.fullName} ${a.patient.fullName} ${a.clinic.name}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .sort((a, b) =>
      tab === 'past' ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt),
    );
  async function action(a: Appointment, path: string) {
    setBusy(true);
    try {
      await post(`/appointments/${a.id}/${path}`, path === 'cancel' ? { reason } : {});
      toast(
        path === 'cancel'
          ? 'Appointment cancelled. Any eligible refund will be processed.'
          : 'Appointment updated',
      );
      await client.invalidateQueries({ queryKey: ['appointments'] });
      setCancel(null);
      setDetail(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const staff = !!clinicId;
  const doctor = reschedule && doctors.data?.find((d) => d.userId === reschedule.doctorId);
  return (
    <>
      <PageHeading
        title="Your appointments"
        description="Every visit, thoughtfully organized. All times in Asia/Dhaka."
        action={
          <Link href="/doctors" className="button primary">
            <CalendarPlus size={18} />
            Book a visit
          </Link>
        }
      />
      <div className="filters">
        <div className="search-field">
          <Search size={18} />
          <input
            placeholder="Search doctor, patient, or clinic…"
            aria-label="Search appointments"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <section className="panel">
        <div className="tabs">
          {[
            ['upcoming', 'Upcoming'],
            ['today', 'Today'],
            ['past', 'Past & cancelled'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{staff ? 'Patient / Doctor' : 'Doctor'}</th>
                  <th>Date & time</th>
                  <th>Consultation</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} data-testid={`appointment-${a.id}`}>
                    <td>
                      <div className="person-cell">
                        <Avatar
                          name={staff ? a.patient.fullName : a.doctor.user.fullName}
                          color={a.doctor.color}
                        />
                        <div>
                          <strong>{staff ? a.patient.fullName : a.doctor.user.fullName}</strong>
                          <small>{staff ? a.doctor.user.fullName : a.doctor.specialties[0]}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{dateLabel(a.startAt)}</strong>
                      <small>{timeLabel(a.startAt)}</small>
                    </td>
                    <td>
                      <Badge status={a.type} />
                      <small>{a.clinic.name}</small>
                    </td>
                    <td>
                      <Badge status={a.status} />
                    </td>
                    <td>
                      <button className="button secondary small" onClick={() => setDetail(a)}>
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={tab === 'today' ? 'A little breathing room today.' : 'No appointments here yet.'}
            body="Your visits will appear here as you book them."
            action={{ href: '/doctors', label: 'Find your doctor' }}
          />
        )}
      </section>
      {detail && (
        <Modal title="Your appointment" onClose={() => setDetail(null)}>
          <div className="booking-doctor">
            <Avatar large name={detail.doctor.user.fullName} color={detail.doctor.color} />
            <div>
              <h3>{detail.doctor.user.fullName}</h3>
              <p>{detail.doctor.specialties[0]}</p>
              <Badge status={detail.status} />
            </div>
          </div>
          <div className="detail-line">
            <CalendarDays size={17} />
            {dateLabel(detail.startAt)}
          </div>
          <div className="detail-line">
            <Clock3 size={17} />
            {timeLabel(detail.startAt)} – {timeLabel(detail.endAt)}
          </div>
          <div className="detail-line">
            <MapPin size={17} />
            {detail.clinic.name}
          </div>
          <p className="small" style={{ margin: '8px 0 20px' }}>
            {detail.clinic.address}
          </p>
          <div className="booking-summary">
            <p className="small">Patient: {detail.patient.fullName}</p>
            <p className="small">Consultation fee: {money(detail.feeMinor)}</p>
            <p className="small">{detail.reason || 'No visit reason provided.'}</p>
          </div>
          <div className="row-actions" style={{ marginTop: 20 }}>
            {!terminal.includes(detail.status) && (
              <>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => {
                    setCancel(detail);
                    setDetail(null);
                  }}
                >
                  Cancel visit
                </button>
                {detail.status === 'CONFIRMED' && new Date(detail.startAt) > new Date() && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setReschedule(detail);
                      setDetail(null);
                    }}
                  >
                    Reschedule
                  </button>
                )}
              </>
            )}
            {detail.status === 'CONFIRMED' && (user.id === detail.doctorId || staff) && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => action(detail, 'check-in')}
              >
                Check in
              </button>
            )}
            {detail.status === 'CHECKED_IN' && user.id === detail.doctorId && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => action(detail, 'start')}
              >
                Start consultation
              </button>
            )}
            {['IN_PROGRESS', 'COMPLETED'].includes(detail.status) &&
              user.id === detail.doctorId && (
                <button
                  className="button primary"
                  onClick={() => {
                    setConsult(detail);
                    setDetail(null);
                  }}
                >
                  <FileText size={16} />
                  Clinical workspace
                </button>
              )}
            {detail.type === 'TELEMEDICINE' && (
              <Link className="button secondary" href="/telemedicine">
                <Video size={17} />
                Open waiting room
              </Link>
            )}
            <a
              className="button secondary"
              href={`/api/payments/${detail.id}/invoice`}
              target="_blank"
              rel="noreferrer"
            >
              Download invoice
            </a>
          </div>
          {user.roles.some((r) => r.clinicId === detail.clinicId && r.role === 'NURSE') && (
            <Vitals appointmentId={detail.id} editable />
          )}
        </Modal>
      )}
      {cancel && (
        <Modal title="Cancel your visit?" onClose={() => setCancel(null)}>
          <div className="warning-box">
            Refunds: more than 24 hours before → 100%; 2–24 hours → 50%; within 2 hours → no refund.
            Doctor cancellations receive a full refund.
          </div>
          <label style={{ marginTop: 20 }}>
            Reason (optional)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setCancel(null)}>
              Keep appointment
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => action(cancel, 'cancel')}
            >
              {busy ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
          </div>
        </Modal>
      )}
      {reschedule && doctor && (
        <BookingModal
          doctor={doctor}
          user={user}
          initialClinic={reschedule.clinicId}
          reschedule={reschedule}
          onClose={() => setReschedule(null)}
        />
      )}
      {consult && <Consultation appointment={consult} onClose={() => setConsult(null)} />}
    </>
  );
}
