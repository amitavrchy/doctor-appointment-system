'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, CalendarDays, CheckCircle2, Target, Trash2 } from 'lucide-react';
import { api, post, dateLabel, localDate } from '@/lib/api';
import type { User } from '@/lib/types';
import { PageHeading, Modal, Loading, ErrorState, Empty, Avatar, Badge } from '../ui';
import { useToast } from '../providers';
type Plan = {
  id: string;
  patientId: string;
  doctorId: string;
  title: string;
  description: string;
  status: string;
  reviewAt: string | null;
  patient: { fullName: string };
  doctor: { fullName: string };
  clinic: { name: string };
  tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null }[];
};
export function CarePlans({ user, clinicId }: { user: User; clinicId: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [create, setCreate] = useState(false),
    [pendingTasks, setPendingTasks] = useState<Record<string, boolean>>({}),
    [tab, setTab] = useState('ACTIVE'),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['care-plans'],
    queryFn: () => api<Plan[]>('/clinical/plans'),
  });
  const doctor = user.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR');
  const patients = useQuery({
    queryKey: ['patients', clinicId],
    queryFn: () => api<{ id: string; fullName: string }[]>(`/patients?clinicId=${clinicId}`),
    enabled: doctor,
  });
  const [patientId, setPatientId] = useState(''),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [review, setReview] = useState(localDate(14)),
    [tasks, setTasks] = useState([{ title: '', dueAt: localDate(7) }]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/clinical/plans', {
        patientId: patientId || patients.data?.[0]?.id,
        clinicId,
        title,
        description,
        reviewAt: `${review}T12:00:00+06:00`,
        tasks: tasks.map((t) => ({
          title: t.title,
          ...(t.dueAt ? { dueAt: `${t.dueAt}T12:00:00+06:00` } : {}),
        })),
      });
      await query.refetch();
      setCreate(false);
      setTitle('');
      setDescription('');
      setTasks([{ title: '', dueAt: localDate(7) }]);
      toast('The care plan has been shared with your patient.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Small steps. Connected care."
        title="A plan beyond the appointment."
        description="Follow your doctor’s plan, keep track of the next steps, and make progress at your own pace."
        action={
          doctor ? (
            <button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={17} />
              Create care plan
            </button>
          ) : undefined
        }
      />
      <div className="care-plan-banner">
        <Target size={34} />
        <div>
          <h3>Your next steps, in one place.</h3>
          <p>
            Tasks are set by your treating doctor. Check them off when completed and bring questions
            to your next visit.
          </p>
        </div>
      </div>
      <div className="filters">
        {['ACTIVE', 'COMPLETED', 'ARCHIVED'].map((status) => (
          <button
            key={status}
            className={`filter-chip ${tab === status ? 'active' : ''}`}
            onClick={() => setTab(status)}
          >
            {status[0] + status.slice(1).toLowerCase()}{' '}
            <span>{query.data?.filter((p) => p.status === status).length || 0}</span>
          </button>
        ))}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.some((p) => p.status === tab) ? (
        <section className="panel">
          <Empty
            title="Room for your next step"
            body={
              doctor
                ? 'Create a care plan after a consultation to guide your patient’s follow-up.'
                : 'Your doctor’s care plans will appear here, with tasks you can complete at your own pace.'
            }
          />
        </section>
      ) : (
        <div className="care-plan-grid">
          {query.data
            .filter((p) => p.status === tab)
            .map((plan) => {
              const completed = plan.tasks.filter((t) => t.completedAt).length,
                progress = plan.tasks.length
                  ? Math.round((completed / plan.tasks.length) * 100)
                  : 0;
              return (
                <article className="panel care-plan-card" key={plan.id}>
                  <div className="care-plan-title">
                    <span className="stat-icon">
                      <ClipboardCheck size={22} />
                    </span>
                    <Badge status={plan.status} />
                  </div>
                  <h2>{plan.title}</h2>
                  <p className="care-plan-description">{plan.description}</p>
                  <div className="person-cell" style={{ margin: '20px 0' }}>
                    <Avatar name={plan.doctor.fullName} />
                    <div>
                      <strong>
                        {user.id === plan.doctorId ? plan.patient.fullName : plan.doctor.fullName}
                      </strong>
                      <small>{plan.clinic.name}</small>
                    </div>
                  </div>
                  <div className="progress-label">
                    <span>
                      {completed} of {plan.tasks.length} steps completed
                    </span>
                    <strong>{progress}%</strong>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="Care plan progress"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <div className="care-task-list">
                    {plan.tasks.map((task) => (
                      <label
                        className={`care-task ${task.completedAt ? 'done' : ''}`}
                        key={task.id}
                      >
                        <input
                          type="checkbox"
                          checked={pendingTasks[task.id] ?? !!task.completedAt}
                          disabled={plan.status !== 'ACTIVE' || task.id in pendingTasks}
                          onChange={async (e) => {
                            const completed = e.target.checked;
                            setPendingTasks((previous) => ({ ...previous, [task.id]: completed }));
                            try {
                              await api(`/clinical/plans/${plan.id}/tasks/${task.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ completed }),
                              });
                              await query.refetch();
                            } catch (e) {
                              toast((e as Error).message, true);
                            } finally {
                              setPendingTasks((previous) => {
                                const next = { ...previous };
                                delete next[task.id];
                                return next;
                              });
                            }
                          }}
                        />
                        <span>
                          <strong>{task.title}</strong>
                          {task.dueAt && <small>Due {dateLabel(task.dueAt)}</small>}
                        </span>
                        {task.completedAt && <CheckCircle2 size={18} />}
                      </label>
                    ))}
                  </div>
                  {plan.reviewAt && (
                    <p className="detail-line">
                      <CalendarDays size={16} />
                      Review planned for {dateLabel(plan.reviewAt)}
                    </p>
                  )}
                  {user.id === plan.doctorId && (
                    <div className="row-actions" style={{ marginTop: 18 }}>
                      {(plan.status === 'ACTIVE' ? ['COMPLETED', 'ARCHIVED'] : ['ACTIVE']).map(
                        (status) => (
                          <button
                            key={status}
                            className="button secondary small"
                            onClick={async () => {
                              try {
                                await api(`/clinical/plans/${plan.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status }),
                                });
                                await query.refetch();
                                toast('Care plan updated.');
                              } catch (e) {
                                toast((e as Error).message, true);
                              }
                            }}
                          >
                            {status === 'COMPLETED'
                              ? 'Mark complete'
                              : status === 'ARCHIVED'
                                ? 'Archive plan'
                                : 'Reactivate'}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      )}
      {create && (
        <Modal title="Create a follow-up care plan" wide onClose={() => setCreate(false)}>
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Patient
                <select
                  required
                  value={patientId || patients.data?.[0]?.id || ''}
                  onChange={(e) => setPatientId(e.target.value)}
                >
                  <option value="" disabled>
                    Select your patient
                  </option>
                  {patients.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review date
                <input
                  type="date"
                  min={localDate()}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              Plan title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Post-consultation follow-up"
                minLength={2}
                maxLength={150}
                required
              />
            </label>
            <label>
              Care instructions
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                rows={3}
              />
            </label>
            <h3>Follow-up tasks</h3>
            {tasks.map((task, index) => (
              <div className="task-editor" key={index}>
                <label>
                  Task {index + 1}
                  <input
                    value={task.title}
                    onChange={(e) =>
                      setTasks(
                        tasks.map((t, i) => (i === index ? { ...t, title: e.target.value } : t)),
                      )
                    }
                    minLength={2}
                    maxLength={300}
                    required
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={task.dueAt}
                    min={localDate()}
                    onChange={(e) =>
                      setTasks(
                        tasks.map((t, i) => (i === index ? { ...t, dueAt: e.target.value } : t)),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove task ${index + 1}`}
                  disabled={tasks.length < 2}
                  onClick={() => setTasks(tasks.filter((_, i) => i !== index))}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={tasks.length >= 30}
                onClick={() => setTasks([...tasks, { title: '', dueAt: localDate(7) }])}
              >
                <Plus size={16} />
                Add task
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? 'Sharing plan…' : 'Share care plan'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
