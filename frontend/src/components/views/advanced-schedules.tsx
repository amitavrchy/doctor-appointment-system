'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import {
  CalendarClock,
  Plus,
  Clock3,
  DoorOpen,
  Edit3,
  Archive,
  AlertCircle,
  CheckCircle2,
  Repeat,
  RotateCcw,
  Eye,
} from 'lucide-react';
import { api, post, money, dateLabel, localDate } from '@/lib/api';
import type { User, Doctor, Clinic, Appointment } from '@/lib/types';
import { PageHeading, Modal, Loading, ErrorState, Empty, Avatar, Badge } from '../ui';
import { useToast } from '../providers';
type Rule = {
  id: string;
  doctorId: string;
  clinicId: string;
  rrule: string;
  startTimeLocal: string;
  endTimeLocal: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  consultationType: string;
  feeMinor: number;
  roomId: string | null;
  active: boolean;
  doctor: { user: { fullName: string } };
};
type Exception = {
  id: string;
  doctorId: string;
  dateLocal: string;
  type: string;
  reason: string | null;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  seriesId: string | null;
};
type Conflict = { id: string; reason: string; appointment: Appointment };
export function AdvancedSchedules({ user, clinicId }: { user: User; clinicId: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [modal, setModal] = useState<'rule' | 'block' | null>(null),
    [editing, setEditing] = useState<Rule | null>(null),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [doctorId, setDoctorId] = useState(''),
    [rrule, setRrule] = useState('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
    [start, setStart] = useState('09:00'),
    [end, setEnd] = useState('13:00'),
    [duration, setDuration] = useState(30),
    [buffer, setBuffer] = useState(5),
    [fee, setFee] = useState(1200),
    [type, setType] = useState('IN_PERSON'),
    [roomId, setRoomId] = useState(''),
    [from, setFrom] = useState(localDate()),
    [to, setTo] = useState(''),
    [preview, setPreview] = useState<Appointment[] | null>(null),
    [exceptionType, setExceptionType] = useState('DAY_OFF'),
    [repeat, setRepeat] = useState(false),
    [blockRule, setBlockRule] = useState('FREQ=WEEKLY;BYDAY=MO'),
    [until, setUntil] = useState(localDate(30)),
    [reason, setReason] = useState(''),
    [remove, setRemove] = useState<Exception | null>(null),
    [scope, setScope] = useState('this_only');
  const query = useQuery({
      queryKey: ['schedules', clinicId],
      queryFn: () =>
        api<{ rules: Rule[]; exceptions: Exception[] }>(`/schedules?clinicId=${clinicId}`),
      enabled: !!clinicId,
    }),
    doctors = useQuery({
      queryKey: ['doctors', clinicId],
      queryFn: () => api<Doctor[]>(`/doctors?clinicId=${clinicId}`),
    }),
    clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') }),
    conflicts = useQuery({
      queryKey: ['schedule-conflicts', clinicId],
      queryFn: () => api<Conflict[]>(`/schedules/conflicts?clinicId=${clinicId}`),
    });
  const clinic = clinics.data?.find((c) => c.id === clinicId),
    zone = clinic?.timezone || 'Asia/Dhaka',
    admin =
      user.globalRole === 'SUPER_ADMIN' ||
      user.roles.some((r) => r.clinicId === clinicId && r.role === 'CLINIC_ADMIN'),
    choices = doctors.data?.filter((d) => admin || d.userId === user.id) || [],
    selectedDoctor = doctorId || choices[0]?.userId || '';
  async function refresh() {
    await query.refetch();
    void conflicts.refetch();
    void client.invalidateQueries({ queryKey: ['slots'] });
  }
  function edit(rule?: Rule) {
    setEditing(rule || null);
    setDoctorId(rule?.doctorId || choices[0]?.userId || '');
    setRrule(rule?.rrule || 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    setStart(rule?.startTimeLocal || '09:00');
    setEnd(rule?.endTimeLocal || '13:00');
    setDuration(rule?.slotDurationMinutes || 30);
    setBuffer(rule?.bufferMinutes ?? 5);
    setFee((rule?.feeMinor || 120000) / 100);
    setType(rule?.consultationType || 'IN_PERSON');
    setRoomId(rule?.roomId || '');
    setFrom(rule ? DateTime.fromISO(rule.effectiveFrom).setZone(zone).toISODate()! : localDate());
    setTo(rule?.effectiveTo ? DateTime.fromISO(rule.effectiveTo).setZone(zone).toISODate()! : '');
    setPreview(null);
    setModal('rule');
  }
  function ruleBody() {
    return {
      doctorId: selectedDoctor,
      clinicId,
      rrule,
      startTimeLocal: start,
      endTimeLocal: end,
      slotDurationMinutes: duration,
      bufferMinutes: buffer,
      effectiveFrom: DateTime.fromISO(from, { zone }).toUTC().toISO(),
      effectiveTo: to ? DateTime.fromISO(to, { zone }).endOf('day').toUTC().toISO() : null,
      consultationType: type,
      feeMinor: Math.round(fee * 100),
      roomId: roomId || null,
    };
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal === 'rule') {
        const result = editing
          ? await api<{ conflicts: Appointment[] }>(`/schedules/rules/${editing.id}`, {
              method: 'PATCH',
              body: JSON.stringify(ruleBody()),
            })
          : await post<{ conflicts: Appointment[] }>('/schedules/advanced/rules', ruleBody());
        toast(
          result.conflicts.length
            ? `${result.conflicts.length} booked visits require review. Existing visits were retained.`
            : 'Availability saved.',
        );
      } else {
        const result = await post<{ conflicts: Appointment[] }>('/schedules/blocks', {
          doctorId: selectedDoctor,
          clinicId,
          dateLocal: from,
          type: exceptionType,
          ...(exceptionType !== 'DAY_OFF' ? { startTimeLocal: start, endTimeLocal: end } : {}),
          reason,
          ...(repeat ? { rrule: blockRule, until } : {}),
        });
        toast(
          result.conflicts.length
            ? `${result.conflicts.length} visits were flagged for review.`
            : 'Schedule exception saved.',
        );
      }
      await refresh();
      setModal(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const rules = query.data.rules.filter((r) => (archived ? !r.active : r.active)),
    exceptions = query.data.exceptions
      .filter((e) => e.dateLocal.slice(0, 10) >= localDate())
      .sort((a, b) => a.dateLocal.localeCompare(b.dateLocal));
  return (
    <>
      <PageHeading
        eyebrow="Availability & resource planning"
        title="A schedule that makes room for care."
        description="Recurring rules, clinic rooms, buffered slots, date exceptions, and a review trail for affected bookings."
        action={
          <div className="row-actions">
            <button
              className="button secondary"
              onClick={() => {
                setModal('block');
                setFrom(localDate(1));
                setPreview(null);
              }}
            >
              Add time off / block
            </button>
            <button className="button primary" onClick={() => edit()}>
              <Plus size={17} />
              Add availability
            </button>
          </div>
        }
      />
      {!!conflicts.data?.length && (
        <section className="panel conflict-panel">
          <div className="panel-head">
            <div>
              <h2>
                <AlertCircle size={21} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                Bookings requiring review
              </h2>
              <p>These appointments were retained after availability changed.</p>
            </div>
            <span className="tag">{conflicts.data.length} open</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Booked time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.appointment.patient.fullName}</strong>
                    </td>
                    <td>{c.appointment.doctor.user.fullName}</td>
                    <td>
                      {dateLabel(c.appointment.startAt, {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <div className="row-actions">
                        <a
                          className="button secondary small"
                          href={`/appointments?appointment=${c.appointment.id}`}
                        >
                          Manage visit
                        </a>
                        <button
                          className="button secondary small"
                          onClick={async () => {
                            try {
                              await post(`/schedules/conflicts/${c.id}/resolve`);
                              void conflicts.refetch();
                              toast('Review recorded. The booking has been retained.');
                            } catch (e) {
                              toast((e as Error).message, true);
                            }
                          }}
                        >
                          Reviewed & keep visit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="section-row">
        <h2>Recurring availability</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <span>Show archived rules</span>
        </label>
      </div>
      {rules.length ? (
        <div className="schedule-rule-grid">
          {rules.map((rule) => (
            <article className="panel schedule-rule-card" key={rule.id}>
              <div className="person-cell">
                <Avatar
                  name={rule.doctor.user.fullName}
                  color={doctors.data?.find((d) => d.userId === rule.doctorId)?.color}
                />
                <div>
                  <h3>{rule.doctor.user.fullName}</h3>
                  <Badge status={rule.consultationType} />
                </div>
              </div>
              <div className="schedule-window">
                <strong>{rule.startTimeLocal}</strong>
                <span>to</span>
                <strong>{rule.endTimeLocal}</strong>
              </div>
              <p className="rrule-label">
                <Repeat size={16} />
                <code>{rule.rrule}</code>
              </p>
              <div className="schedule-rule-details">
                <span>
                  <Clock3 size={15} />
                  {rule.slotDurationMinutes} min · {rule.bufferMinutes} min buffer
                </span>
                <span>
                  <DoorOpen size={15} />
                  {clinic?.rooms.find((r) => r.id === rule.roomId)?.name || 'No room assigned'}
                </span>
                <span>Fee {money(rule.feeMinor)}</span>
                <span>
                  From {dateLabel(rule.effectiveFrom)}
                  {rule.effectiveTo ? ` to ${dateLabel(rule.effectiveTo)}` : ''}
                </span>
              </div>
              <div className="row-actions">
                {rule.active ? (
                  <>
                    <button className="button secondary small" onClick={() => edit(rule)}>
                      <Edit3 size={15} />
                      Edit rule
                    </button>
                    <button
                      className="button danger small"
                      onClick={async () => {
                        try {
                          const result = await api<{ conflicts: Appointment[] }>(
                            `/schedules/rules/${rule.id}`,
                            { method: 'DELETE' },
                          );
                          await refresh();
                          toast(
                            result.conflicts.length
                              ? `Rule archived. ${result.conflicts.length} booked visits need review.`
                              : 'Availability rule archived.',
                          );
                        } catch (e) {
                          toast((e as Error).message, true);
                        }
                      }}
                    >
                      <Archive size={15} />
                      Archive
                    </button>
                  </>
                ) : (
                  <button
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        await post(`/schedules/rules/${rule.id}/restore`);
                        await refresh();
                        toast('Availability restored.');
                      } catch (e) {
                        toast((e as Error).message, true);
                      }
                    }}
                  >
                    <RotateCcw size={15} />
                    Restore rule
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={archived ? 'No archived availability' : 'Start with a little availability'}
            body="Create daily, weekly or monthly availability, with a clinic room and buffers between visits."
          />
        </section>
      )}
      <section className="panel" style={{ marginTop: 26 }}>
        <div className="panel-head">
          <div>
            <h2>Time off & date exceptions</h2>
            <p>Upcoming day-off, custom-hour and blocked windows.</p>
          </div>
          <CalendarClock size={21} color="#0d776e" />
        </div>
        {exceptions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Doctor</th>
                  <th>Exception</th>
                  <th>Hours / reason</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exceptions.slice(0, 100).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.dateLocal.slice(0, 10)}</strong>
                      {e.seriesId && <small>Recurring series</small>}
                    </td>
                    <td>{doctors.data?.find((d) => d.userId === e.doctorId)?.user.fullName}</td>
                    <td>
                      <Badge status={e.type} />
                    </td>
                    <td>
                      {e.startTimeLocal ? `${e.startTimeLocal}-${e.endTimeLocal}` : 'Full day'}
                      <small>{e.reason || 'No reason provided'}</small>
                    </td>
                    <td>
                      <button
                        className="button secondary small"
                        onClick={() => {
                          setRemove(e);
                          setScope('this_only');
                        }}
                      >
                        Remove block
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A clear calendar"
            body="Upcoming time off and recurring blocks will appear here."
          />
        )}
      </section>
      {modal && (
        <Modal
          title={
            modal === 'rule'
              ? editing
                ? 'Edit recurring availability'
                : 'Create recurring availability'
              : 'Add time off or a blocked window'
          }
          wide
          onClose={() => setModal(null)}
        >
          <form className="form-stack" onSubmit={save}>
            <label>
              Doctor
              <select
                value={selectedDoctor}
                onChange={(e) => setDoctorId(e.target.value)}
                disabled={!!editing}
                required
              >
                {choices.map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.user.fullName}
                  </option>
                ))}
              </select>
            </label>
            {modal === 'rule' ? (
              <>
                <div className="form-grid">
                  <label>
                    Consultation type
                    <select value={type} onChange={(e) => setType(e.target.value)}>
                      <option value="IN_PERSON">In person</option>
                      <option value="TELEMEDICINE">Telemedicine</option>
                    </select>
                  </label>
                  <label>
                    Consultation room
                    <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                      <option value="">No room assigned</option>
                      {clinic?.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Effective from
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Effective until (optional)
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label>
                    Slot duration (minutes)
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      required
                    />
                  </label>
                  <label>
                    Buffer between visits (minutes)
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={buffer}
                      onChange={(e) => setBuffer(Number(e.target.value))}
                      required
                    />
                  </label>
                  <label>
                    Consultation fee (BDT)
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      step={0.01}
                      value={fee}
                      onChange={(e) => setFee(Number(e.target.value))}
                      required
                    />
                  </label>
                </div>
                <label>
                  Repeat rule (RRULE)
                  <input
                    value={rrule}
                    onChange={(e) => {
                      setRrule(e.target.value.toUpperCase());
                      setPreview(null);
                    }}
                    placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
                    maxLength={500}
                    required
                  />
                </label>
                <div className="row-actions">
                  {[
                    ['Weekdays', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
                    ['Every day', 'FREQ=DAILY'],
                    ['Every other week', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'],
                    ['Monthly first day', 'FREQ=MONTHLY;BYMONTHDAY=1'],
                    ['Last Friday', 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'],
                  ].map(([label, value]) => (
                    <button
                      type="button"
                      key={label}
                      className="filter-chip"
                      onClick={() => {
                        setRrule(value);
                        setPreview(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    Exception type
                    <select
                      value={exceptionType}
                      onChange={(e) => setExceptionType(e.target.value)}
                    >
                      <option value="DAY_OFF">Day off</option>
                      <option value="CUSTOM_HOURS">Custom hours</option>
                      <option value="BLOCK">Block a time window</option>
                    </select>
                  </label>
                  <label>
                    {repeat ? 'Series starts on' : 'Date'}
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                  />
                  <span>Repeat this exception as a series</span>
                </label>
                {repeat && (
                  <div className="form-grid">
                    <label>
                      Repeat rule
                      <input
                        value={blockRule}
                        onChange={(e) => setBlockRule(e.target.value.toUpperCase())}
                        required
                        maxLength={500}
                      />
                    </label>
                    <label>
                      Series ends on
                      <input
                        type="date"
                        value={until}
                        min={from}
                        max={localDate(365)}
                        onChange={(e) => setUntil(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                )}
                <label>
                  Reason (optional)
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </label>
              </>
            )}
            {(modal === 'rule' || exceptionType !== 'DAY_OFF') && (
              <div className="form-grid">
                <label>
                  Start time ({zone})
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setPreview(null);
                    }}
                    required
                  />
                </label>
                <label>
                  End time ({zone})
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setPreview(null);
                    }}
                    required
                  />
                </label>
              </div>
            )}
            <div className="info-box">
              Existing bookings are retained. Changes that no longer cover a booked visit create a
              review flag instead of cancelling the visit. Doctor and room overlap checks apply when
              a slot is reserved.
            </div>
            {preview && (
              <div className={preview.length ? 'warning-box' : 'info-box'}>
                {preview.length
                  ? `${preview.length} existing visits would require review.`
                  : 'No existing visits lose availability in this preview.'}
                {preview.slice(0, 5).map((a) => (
                  <p key={a.id} className="small" style={{ marginTop: 8 }}>
                    {a.patient.fullName} ·{' '}
                    {dateLabel(a.startAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                ))}
              </div>
            )}
            <div className="form-actions">
              {modal === 'rule' && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !selectedDoctor}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await post<{ conflicts: Appointment[] }>(
                        '/schedules/preview',
                        { ruleId: editing?.id, rule: ruleBody() },
                      );
                      setPreview(result.conflicts);
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Eye size={17} />
                  Preview impact
                </button>
              )}
              <button className="button primary" disabled={busy || !selectedDoctor}>
                {busy ? 'Saving…' : 'Save availability'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Remove this schedule exception?" onClose={() => setRemove(null)}>
          <p>
            The selected block is on {remove.dateLocal.slice(0, 10)}. Existing appointments will
            remain intact.
          </p>
          {remove.seriesId && (
            <label style={{ marginTop: 20 }}>
              Remove from series
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="this_only">This date only</option>
                <option value="this_and_future">This date and all future dates</option>
              </select>
            </label>
          )}
          <div className="form-actions">
            <button className="button secondary" onClick={() => setRemove(null)}>
              Keep block
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/schedules/exceptions/${remove.id}?scope=${scope}`, {
                    method: 'DELETE',
                  });
                  await refresh();
                  setRemove(null);
                  toast('Schedule exception removed.');
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove exception
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
