'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FlaskConical,
  Plus,
  FileText,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Download,
  Send,
} from 'lucide-react';
import { api, post, dateLabel } from '@/lib/api';
import type { User, Appointment, Doctor } from '@/lib/types';
import { PageHeading, Modal, Loading, ErrorState, Empty, Badge, Avatar } from '../ui';
import { useToast } from '../providers';
type Result = { name: string; value: string; unit: string; reference: string; flag: string };
type Lab = {
  id: string;
  appointmentId: string;
  title: string;
  status: string;
  tests: { name: string; instructions: string }[];
  results: Result[] | null;
  resultAttachmentId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  appointment: {
    id: string;
    doctorId: string;
    patientId: string;
    patient: { fullName: string };
    doctor: { user: { fullName: string } };
    clinic: { name: string };
  };
};
type Referral = {
  id: string;
  targetDoctorId: string | null;
  specialty: string;
  reason: string;
  status: string;
  createdAt: string;
  appointment: {
    doctorId: string;
    patient: { fullName: string };
    doctor: { user: { fullName: string } };
  };
  targetDoctor: { user: { fullName: string } } | null;
};
type Template = {
  id: string;
  title: string;
  authorId: string;
  shared: boolean;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
};
export function ClinicalStudio({ user, clinicId }: { user: User; clinicId: string }) {
  const toast = useToast();
  const [tab, setTab] = useState('labs'),
    [modal, setModal] = useState<'lab' | 'referral' | 'template' | null>(null),
    [selected, setSelected] = useState<Lab | null>(null),
    [busy, setBusy] = useState(false),
    [appointmentId, setAppointmentId] = useState(''),
    [title, setTitle] = useState(''),
    [instructions, setInstructions] = useState(''),
    [targetDoctor, setTargetDoctor] = useState(''),
    [specialty, setSpecialty] = useState(''),
    [reason, setReason] = useState(''),
    [shared, setShared] = useState(false),
    [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' }),
    [results, setResults] = useState<Result[]>([]);
  const doctor = user.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR');
  const labs = useQuery({
      queryKey: ['labs', clinicId],
      queryFn: () => api<Lab[]>(`/clinical/labs?clinicId=${clinicId}`),
    }),
    referrals = useQuery({
      queryKey: ['referrals'],
      queryFn: () => api<Referral[]>('/clinical/referrals'),
    }),
    templates = useQuery({
      queryKey: ['templates', clinicId],
      queryFn: () => api<Template[]>(`/clinical/templates?clinicId=${clinicId}`),
      enabled: doctor,
    }),
    visits = useQuery({
      queryKey: ['appointments', clinicId],
      queryFn: () => api<Appointment[]>(`/appointments?clinicId=${clinicId}`),
      enabled: doctor,
    }),
    doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
  const eligible =
    visits.data?.filter(
      (a) => a.doctorId === user.id && ['IN_PROGRESS', 'COMPLETED'].includes(a.status),
    ) || [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal === 'lab') {
        await post('/clinical/labs', {
          appointmentId: appointmentId || eligible[0]?.id,
          title,
          tests: instructions
            .split('\n')
            .filter(Boolean)
            .map((name) => ({ name, instructions: '' })),
        });
        await labs.refetch();
      }
      if (modal === 'referral') {
        await post('/clinical/referrals', {
          appointmentId: appointmentId || eligible[0]?.id,
          specialty,
          reason,
          ...(targetDoctor ? { targetDoctorId: targetDoctor } : {}),
        });
        await referrals.refetch();
      }
      if (modal === 'template') {
        await post('/clinical/templates', { clinicId, title, soap, shared });
        await templates.refetch();
      }
      setModal(null);
      setTitle('');
      setInstructions('');
      toast('Clinical record saved.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function labStatus(lab: Lab, status: string) {
    setBusy(true);
    try {
      await api(`/clinical/labs/${lab.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(status === 'RESULT_UPLOADED' ? { results } : {}) }),
      });
      await labs.refetch();
      setSelected(null);
      toast(
        status === 'REVIEWED' ? 'Results reviewed and signed off.' : 'Laboratory order updated.',
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const activeQuery = tab === 'labs' ? labs : tab === 'referrals' ? referrals : templates;
  return (
    <>
      <PageHeading
        eyebrow="A fuller picture of care"
        title="Tests, insights, and next steps."
        description="Follow laboratory orders, review results, coordinate referrals, and reuse your consultation templates."
        action={
          doctor ? (
            <button
              className="button primary"
              onClick={() =>
                setModal(tab === 'labs' ? 'lab' : tab === 'referrals' ? 'referral' : 'template')
              }
            >
              <Plus size={17} />
              {tab === 'labs'
                ? 'Order laboratory tests'
                : tab === 'referrals'
                  ? 'Create referral'
                  : 'Create template'}
            </button>
          ) : undefined
        }
      />
      <div className="clinical-tabs">
        <button className={tab === 'labs' ? 'active' : ''} onClick={() => setTab('labs')}>
          <FlaskConical size={19} />
          Laboratory & results <span>{labs.data?.length || 0}</span>
        </button>
        <button className={tab === 'referrals' ? 'active' : ''} onClick={() => setTab('referrals')}>
          <Send size={19} />
          Referrals <span>{referrals.data?.length || 0}</span>
        </button>
        {doctor && (
          <button
            className={tab === 'templates' ? 'active' : ''}
            onClick={() => setTab('templates')}
          >
            <ClipboardList size={19} />
            SOAP templates <span>{templates.data?.length || 0}</span>
          </button>
        )}
      </div>
      {activeQuery.isPending ? (
        <Loading />
      ) : activeQuery.error ? (
        <ErrorState error={activeQuery.error} retry={() => void activeQuery.refetch()} />
      ) : tab === 'labs' ? (
        labs.data?.length ? (
          <div className="lab-grid">
            {labs.data.map((lab) => (
              <article className="panel lab-card" key={lab.id}>
                <div className="lab-card-top">
                  <span className="stat-icon">
                    <FlaskConical size={23} />
                  </span>
                  <Badge status={lab.status} />
                </div>
                <h2>{lab.title}</h2>
                <p className="small">
                  {lab.appointment.patient.fullName} · {lab.appointment.doctor.user.fullName}
                </p>
                <p className="small" style={{ marginTop: 8 }}>
                  {lab.appointment.clinic.name} · Ordered {dateLabel(lab.createdAt)}
                </p>
                <div className="lab-test-tags">
                  {lab.tests.map((t, index) => (
                    <span className="tag" key={index}>
                      {t.name}
                    </span>
                  ))}
                </div>
                {lab.results && (
                  <div className="lab-preview">
                    {lab.results.slice(0, 3).map((r, index) => (
                      <div key={index}>
                        <span>{r.name}</span>
                        <strong className={['HIGH', 'LOW'].includes(r.flag) ? 'result-flag' : ''}>
                          {r.value} {r.unit}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="button secondary full"
                  onClick={() => {
                    setSelected(lab);
                    setResults(
                      lab.results ||
                        lab.tests.map((t) => ({
                          name: t.name,
                          value: '',
                          unit: '',
                          reference: '',
                          flag: 'UNKNOWN',
                        })),
                    );
                  }}
                >
                  View order & results
                  <ArrowUpRight size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <section className="panel">
            <Empty
              title="Your laboratory story starts here"
              body="Requested tests, result values, documents, and your doctor’s review will appear here."
            />
          </section>
        )
      ) : tab === 'referrals' ? (
        referrals.data?.length ? (
          <div className="care-plan-grid">
            {referrals.data.map((r) => (
              <article className="panel lab-card" key={r.id}>
                <div className="lab-card-top">
                  <span className="stat-icon">
                    <Send size={21} />
                  </span>
                  <Badge status={r.status} />
                </div>
                <h2>{r.specialty} referral</h2>
                <p className="small">
                  {r.appointment.patient.fullName} · {dateLabel(r.createdAt)}
                </p>
                <div className="referral-route">
                  <span>{r.appointment.doctor.user.fullName}</span>
                  <ArrowUpRight size={19} />
                  <strong>{r.targetDoctor?.user.fullName || `${r.specialty} specialist`}</strong>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, margin: '18px 0' }}>{r.reason}</p>
                {r.status !== 'CLOSED' &&
                  (r.targetDoctorId === user.id || r.appointment.doctorId === user.id) && (
                    <div className="row-actions">
                      {r.status === 'OPEN' && r.targetDoctorId === user.id && (
                        <button
                          className="button primary"
                          onClick={async () => {
                            try {
                              await api(`/clinical/referrals/${r.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'ACCEPTED' }),
                              });
                              void referrals.refetch();
                            } catch (e) {
                              toast((e as Error).message, true);
                            }
                          }}
                        >
                          Accept referral
                        </button>
                      )}
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await api(`/clinical/referrals/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'CLOSED' }),
                            });
                            void referrals.refetch();
                          } catch (e) {
                            toast((e as Error).message, true);
                          }
                        }}
                      >
                        Close referral
                      </button>
                    </div>
                  )}
              </article>
            ))}
          </div>
        ) : (
          <section className="panel">
            <Empty
              title="Connected care, when you need it"
              body="Referrals from your doctor will appear here. Full medical history still follows your consent preferences."
            />
          </section>
        )
      ) : templates.data?.length ? (
        <div className="care-plan-grid">
          {templates.data.map((t) => (
            <article className="panel lab-card" key={t.id}>
              <div className="lab-card-top">
                <h2>{t.title}</h2>
                <span className="tag">{t.shared ? 'Shared in clinic' : 'Private template'}</span>
              </div>
              <div className="soap">
                {Object.entries(t.soap).map(([key, value]) => (
                  <div key={key}>
                    <h4 style={{ textTransform: 'capitalize' }}>{key}</h4>
                    <p>{value || 'Empty section'}</p>
                  </div>
                ))}
              </div>
              {t.authorId === user.id && (
                <button
                  className="button danger small"
                  onClick={async () => {
                    try {
                      await api(`/clinical/templates/${t.id}`, { method: 'DELETE' });
                      void templates.refetch();
                      toast('Template removed.');
                    } catch (e) {
                      toast((e as Error).message, true);
                    }
                  }}
                >
                  Delete template
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="A little less repetition"
            body="Create private or shared SOAP templates, then load them in the consultation workspace."
          />
        </section>
      )}
      {modal && (
        <Modal
          title={
            modal === 'lab'
              ? 'Order laboratory tests'
              : modal === 'referral'
                ? 'Coordinate a referral'
                : 'Create a SOAP template'
          }
          wide
          onClose={() => setModal(null)}
        >
          <form className="form-stack" onSubmit={save}>
            {modal !== 'template' && (
              <label>
                Consultation
                <select
                  value={appointmentId || eligible[0]?.id || ''}
                  onChange={(e) => setAppointmentId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a consultation
                  </option>
                  {eligible.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.patient.fullName} · {dateLabel(a.startAt)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal !== 'referral' && (
              <label>
                {modal === 'lab' ? 'Order title' : 'Template name'}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={2}
                  maxLength={150}
                  required
                />
              </label>
            )}
            {modal === 'lab' && (
              <label>
                Requested tests (one per line)
                <textarea
                  rows={5}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={'Complete blood count\nFasting blood glucose'}
                  required
                />
              </label>
            )}
            {modal === 'referral' && (
              <>
                <label>
                  Specialty
                  <input
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  Receiving doctor (optional)
                  <select value={targetDoctor} onChange={(e) => setTargetDoctor(e.target.value)}>
                    <option value="">Any suitable specialist</option>
                    {doctors.data
                      ?.filter((d) => d.userId !== user.id)
                      .map((d) => (
                        <option key={d.userId} value={d.userId}>
                          {d.user.fullName} · {d.specialties[0]}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Referral reason & clinical handover
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    minLength={5}
                    maxLength={3000}
                    rows={5}
                    required
                  />
                </label>
                <div className="info-box">
                  The referral shares this handover with the receiving doctor. It does not grant
                  access to the patient’s full cross-clinic history.
                </div>
              </>
            )}
            {modal === 'template' && (
              <>
                <div className="form-grid">
                  {(Object.keys(soap) as (keyof typeof soap)[]).map((key) => (
                    <label key={key} style={{ textTransform: 'capitalize' }}>
                      {key}
                      <textarea
                        value={soap[key]}
                        onChange={(e) => setSoap({ ...soap, [key]: e.target.value })}
                        maxLength={10000}
                      />
                    </label>
                  ))}
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={(e) => setShared(e.target.checked)}
                  />
                  <span>
                    Share this reusable template with clinic doctors. Remove patient-specific
                    information before sharing.
                  </span>
                </label>
              </>
            )}
            <div className="form-actions">
              <button
                className="button primary"
                disabled={busy || (modal !== 'template' && !eligible.length)}
              >
                {busy ? 'Saving…' : 'Save clinical record'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title={selected.title} wide onClose={() => setSelected(null)}>
          <div className="booking-summary">
            <Badge status={selected.status} />
            <p style={{ marginTop: 12 }}>
              {selected.appointment.patient.fullName} · {selected.appointment.doctor.user.fullName}
            </p>
            <p className="small">
              {selected.appointment.clinic.name} · {dateLabel(selected.createdAt)}
            </p>
          </div>
          <div className="lab-test-tags">
            {selected.tests.map((t, index) => (
              <span className="tag" key={index}>
                {t.name}
              </span>
            ))}
          </div>
          {selected.results && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Result</th>
                    <th>Unit</th>
                    <th>Reference</th>
                    <th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.results.map((r, index) => (
                    <tr key={index}>
                      <td>{r.name}</td>
                      <td>
                        <strong>{r.value}</strong>
                      </td>
                      <td>{r.unit || '—'}</td>
                      <td>{r.reference || '—'}</td>
                      <td>
                        <Badge status={r.flag} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selected.resultAttachmentId && (
            <a
              href={`/api/attachments/${selected.resultAttachmentId}`}
              className="button secondary"
              target="_blank"
              rel="noreferrer"
            >
              <Download size={16} />
              Result document
            </a>
          )}
          {selected.appointment.doctorId === user.id &&
            !['REVIEWED', 'CANCELLED'].includes(selected.status) && (
              <>
                <hr />
                {['ORDERED', 'SAMPLE_COLLECTED'].includes(selected.status) && (
                  <>
                    <h3>Enter laboratory results</h3>
                    <div className="result-editor">
                      {results.map((r, index) => (
                        <div className="medication" key={index}>
                          <h4>{r.name}</h4>
                          <div className="form-grid">
                            {(['value', 'unit', 'reference'] as const).map((key) => (
                              <label key={key} style={{ textTransform: 'capitalize' }}>
                                {key}
                                <input
                                  value={r[key]}
                                  onChange={(e) =>
                                    setResults(
                                      results.map((row, i) =>
                                        i === index ? { ...row, [key]: e.target.value } : row,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            ))}
                            <label>
                              Laboratory flag
                              <select
                                value={r.flag}
                                onChange={(e) =>
                                  setResults(
                                    results.map((row, i) =>
                                      i === index ? { ...row, flag: e.target.value } : row,
                                    ),
                                  )
                                }
                              >
                                {['UNKNOWN', 'NORMAL', 'LOW', 'HIGH'].map((f) => (
                                  <option key={f}>{f}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <div className="form-actions">
                  {selected.status === 'ORDERED' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => labStatus(selected, 'SAMPLE_COLLECTED')}
                    >
                      Mark sample collected
                    </button>
                  )}
                  {['ORDERED', 'SAMPLE_COLLECTED'].includes(selected.status) && (
                    <button
                      className="button primary"
                      disabled={busy || results.some((r) => !r.value.trim())}
                      onClick={() => labStatus(selected, 'RESULT_UPLOADED')}
                    >
                      Save results
                    </button>
                  )}
                  {selected.status === 'RESULT_UPLOADED' && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => labStatus(selected, 'REVIEWED')}
                    >
                      <CheckCircle2 size={17} />
                      Review & sign off
                    </button>
                  )}
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => labStatus(selected, 'CANCELLED')}
                  >
                    Cancel order
                  </button>
                </div>
              </>
            )}
          {selected.reviewedAt && (
            <div className="info-box" style={{ marginTop: 20 }}>
              Reviewed by the treating doctor on {dateLabel(selected.reviewedAt)}. Discuss the
              results with your doctor before making changes to your care.
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
