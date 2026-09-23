'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import {
  CalendarDays,
  Plus,
  Video,
  MapPin,
  CalendarClock,
  ArrowUpRight,
  Search,
} from 'lucide-react';
import { api, post, dateLabel, timeLabel, money, localDate } from '@/lib/api';
import type { Appointment, Doctor, User, Hold, Clinic } from '@/lib/types';
import { PageHeading, Loading, ErrorState, Modal, Avatar, Badge } from '../ui';
import { BookingModal } from './doctors';
import { useToast } from '../providers';
export function CalendarWorkspace({ user, clinicId }: { user: User; clinicId?: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [doctorId, setDoctorId] = useState(''),
    [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [selected, setSelected] = useState<Appointment | null>(null),
    [proposed, setProposed] = useState<{ appointment: Appointment; startAt: string } | null>(null),
    [busy, setBusy] = useState(false),
    [booking, setBooking] = useState(false),
    [bookingDay, setBookingDay] = useState(localDate(1));
  const query = useQuery({
    queryKey: ['appointments', clinicId],
    queryFn: () => api<Appointment[]>(`/appointments${clinicId ? `?clinicId=${clinicId}` : ''}`),
    refetchInterval: 30000,
  });
  const doctors = useQuery({
    queryKey: ['doctors', clinicId],
    queryFn: () => api<Doctor[]>(`/doctors${clinicId ? `?clinicId=${clinicId}` : ''}`),
  });
  const clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') });
  const zone = clinics.data?.find((c) => c.id === clinicId)?.timezone || 'Asia/Dhaka';
  const selectedDoctor = doctors.data?.find((d) => d.userId === doctorId) || doctors.data?.[0];
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const all = query.data.filter(
    (a) =>
      (!doctorId || a.doctorId === doctorId) &&
      (!type || a.type === type) &&
      `${a.patient.fullName} ${a.doctor.user.fullName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const live = all.filter((a) => ['CHECKED_IN', 'IN_PROGRESS'].includes(a.status)),
    upcoming = all.filter((a) => a.status === 'CONFIRMED' && new Date(a.startAt) > new Date());
  const color = (a: Appointment) =>
    a.status === 'CANCELLED' || a.status === 'RESCHEDULED'
      ? '#d2d9d5'
      : a.status === 'IN_PROGRESS'
        ? '#cf8d35'
        : a.status === 'CHECKED_IN'
          ? '#8065b0'
          : a.status === 'COMPLETED'
            ? '#8aa69a'
            : a.type === 'TELEMEDICINE'
              ? '#5689ad'
              : '#147b6d';
  return (
    <>
      <PageHeading
        eyebrow="Your care, in perspective"
        title={clinicId ? 'The clinic calendar.' : 'Your calendar of care.'}
        description="Move between month, week, and day. Select a visit for details or drag a confirmed visit to propose a new time."
        action={
          <button className="button primary" onClick={() => setBooking(true)}>
            <Plus size={17} />
            New appointment
          </button>
        }
      />
      <div className="calendar-summary">
        <div>
          <CalendarDays size={21} />
          <span>
            <strong>{upcoming.length}</strong> confirmed ahead
          </span>
        </div>
        <div>
          <CalendarClock size={21} />
          <span>
            <strong>{live.length}</strong> checked in or consulting
          </span>
        </div>
        <div>
          <Video size={21} />
          <span>
            <strong>{all.filter((a) => a.type === 'TELEMEDICINE').length}</strong> online visits
          </span>
        </div>
        <div className="small">Timezone · {zone}</div>
      </div>
      <div className="filters">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search calendar"
            placeholder="Search patient or doctor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Calendar doctor"
          value={doctorId}
          onChange={(e) => setDoctorId(e.target.value)}
        >
          <option value="">All doctors</option>
          {doctors.data?.map((d) => (
            <option key={d.userId} value={d.userId}>
              {d.user.fullName}
            </option>
          ))}
        </select>
        <select
          aria-label="Calendar visit type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All visit types</option>
          <option value="IN_PERSON">In person</option>
          <option value="TELEMEDICINE">Telemedicine</option>
        </select>
      </div>
      <section className="panel calendar-panel">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView="timeGridWeek"
          timeZone={zone}
          nowIndicator
          height="auto"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          slotDuration="00:30:00"
          selectable
          selectMirror
          select={(info) => {
            setBookingDay(info.startStr.slice(0, 10));
            setBooking(true);
          }}
          events={all.map((a) => ({
            id: a.id,
            title: clinicId ? a.patient.fullName : a.doctor.user.fullName,
            start: a.startAt,
            end: a.endAt,
            backgroundColor: color(a),
            borderColor: color(a),
            textColor: '#ffffff',
            editable: a.status === 'CONFIRMED' && new Date(a.startAt) > new Date(),
            extendedProps: { appointment: a },
          }))}
          eventContent={(info) => (
            <div className="calendar-event">
              <span>{info.timeText}</span>
              <strong>{info.event.title}</strong>
              <span>
                {info.event.extendedProps.appointment.type === 'TELEMEDICINE'
                  ? 'Online consultation'
                  : info.event.extendedProps.appointment.doctor.specialties[0]}
              </span>
            </div>
          )}
          eventClick={(info) => setSelected(info.event.extendedProps.appointment)}
          eventDrop={(info) => {
            const a = info.event.extendedProps.appointment as Appointment;
            const startAt = info.event.start?.toISOString();
            info.revert();
            if (startAt) setProposed({ appointment: a, startAt });
          }}
          eventResize={(info) => {
            info.revert();
            toast(
              'Visit duration follows the doctor’s schedule. Choose another slot to change the visit.',
              true,
            );
          }}
        />
      </section>
      <div className="calendar-legend">
        {[
          ['#147b6d', 'In person'],
          ['#5689ad', 'Telemedicine'],
          ['#8065b0', 'Checked in'],
          ['#cf8d35', 'Consulting'],
          ['#8aa69a', 'Completed'],
        ].map(([color, label]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      {selected && (
        <Modal title="Appointment details" onClose={() => setSelected(null)}>
          <div className="booking-doctor">
            <Avatar large name={selected.doctor.user.fullName} color={selected.doctor.color} />
            <div>
              <h3>{selected.doctor.user.fullName}</h3>
              <p className="small">{selected.patient.fullName}</p>
              <Badge status={selected.status} />
            </div>
          </div>
          <p className="detail-line">
            <CalendarDays size={17} />
            {dateLabel(selected.startAt)} · {timeLabel(selected.startAt)}
          </p>
          <p className="detail-line">
            <MapPin size={17} />
            {selected.clinic.name}
          </p>
          <p className="detail-line">
            {money(selected.feeMinor)} · {selected.reason || 'No visit reason provided'}
          </p>
          <div className="form-actions">
            <Link href={`/appointments?appointment=${selected.id}`} className="button primary">
              Manage this appointment
              <ArrowUpRight size={17} />
            </Link>
          </div>
        </Modal>
      )}
      {proposed && (
        <Modal title="Move this appointment?" onClose={() => setProposed(null)}>
          <div className="booking-summary">
            <h3>{proposed.appointment.patient.fullName}</h3>
            <p>{proposed.appointment.doctor.user.fullName}</p>
            <div className="detail-line">
              <span>Current time</span>
              <strong>
                {dateLabel(proposed.appointment.startAt)} ·{' '}
                {timeLabel(proposed.appointment.startAt)}
              </strong>
            </div>
            <div className="detail-line">
              <span>Proposed time</span>
              <strong>
                {dateLabel(proposed.startAt)} · {timeLabel(proposed.startAt)}
              </strong>
            </div>
          </div>
          <div className="info-box" style={{ marginTop: 20 }}>
            Availability and room capacity will be checked again. Existing payments follow the
            clinic’s refund policy; the replacement receives its own invoice.
          </div>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setProposed(null)}>
              Keep original time
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                let hold: Hold | undefined;
                try {
                  hold = await post<Hold>('/appointments/holds', {
                    doctorId: proposed.appointment.doctorId,
                    clinicId: proposed.appointment.clinicId,
                    patientId: proposed.appointment.patientId,
                    startAt: proposed.startAt,
                    type: proposed.appointment.type,
                  });
                  await post(
                    `/appointments/${proposed.appointment.id}/reschedule`,
                    { holdId: hold.id },
                    crypto.randomUUID(),
                  );
                  await client.invalidateQueries({ queryKey: ['appointments'] });
                  setProposed(null);
                  toast('The appointment has been moved.');
                } catch (e) {
                  if (hold)
                    await api(`/appointments/holds/${hold.id}`, { method: 'DELETE' }).catch(
                      () => {},
                    );
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Checking availability…' : 'Confirm new time'}
            </button>
          </div>
        </Modal>
      )}
      {booking && selectedDoctor && (
        <BookingModal
          doctor={selectedDoctor}
          user={user}
          initialClinic={clinicId}
          initialDate={bookingDay}
          onClose={() => setBooking(false)}
        />
      )}
    </>
  );
}
