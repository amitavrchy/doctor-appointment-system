'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import {
  Wallet,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  RefreshCw,
  Plus,
  Settings2,
  ShieldCheck,
  Clock3,
} from 'lucide-react';
import { api, post, money, dateLabel } from '@/lib/api';
import { PageHeading, Loading, ErrorState, Modal, Badge } from '../ui';
import { useToast } from '../providers';
type Policy = {
  fullRefundHours: number;
  partialRefundHours: number;
  partialRefundPercent: number;
  noShowGraceMinutes: number;
  allowPayLater: boolean;
  taxBasisPoints: number;
  invoicePrefix: string;
};
type Service = { id: string; name: string; feeMinor: number; active: boolean };
type FinanceData = {
  clinic: Policy & { name: string; services: Service[] };
  capturedMinor: number;
  refundedMinor: number;
  pendingRefundMinor: number;
  netMinor: number;
  dueMinor: number;
  ledgerDebitMinor: number;
  ledgerCreditMinor: number;
  trend: { date: string; revenueMinor: number }[];
  payments: {
    id: string;
    amountMinor: number;
    refundMinor: number;
    status: string;
    provider: string;
    createdAt: string;
    appointment: {
      id: string;
      patient: { fullName: string };
      doctor: { user: { fullName: string } };
      invoice: { number: string } | null;
    };
  }[];
  ledger: {
    id: string;
    journalId: string;
    account: string;
    side: string;
    amountMinor: number;
    createdAt: string;
  }[];
  runs: {
    id: string;
    provider: string;
    status: string;
    checked: number;
    repaired: number;
    errors: number;
    startedAt: string;
  }[];
};
export function Finance({ clinicId }: { clinicId: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [tab, setTab] = useState('payments'),
    [modal, setModal] = useState<'service' | 'policy' | 'reconcile' | null>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [fee, setFee] = useState(500),
    [editing, setEditing] = useState<Service | null>(null),
    [provider, setProvider] = useState('demo');
  const query = useQuery({
      queryKey: ['finance', clinicId],
      queryFn: () => api<FinanceData>(`/finance/clinic/${clinicId}`),
      enabled: !!clinicId,
      refetchInterval: 10000,
    }),
    providers = useQuery({
      queryKey: ['payment-providers'],
      queryFn: () => api<{ name: string; label: string }[]>('/payments/providers'),
    });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const f = query.data;
  async function service(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, feeMinor: Math.round(fee * 100) };
      if (editing)
        await api(`/finance/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      else await post(`/finance/clinic/${clinicId}/services`, body);
      await query.refetch();
      void client.invalidateQueries({ queryKey: ['clinic-services'] });
      setModal(null);
      toast('Clinic service saved.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Clinic finance workspace"
        title="A clearer picture of every taka."
        description="Consultation income, refunds, numbered invoices, and balanced ledger journals in one place."
        action={
          <div className="row-actions">
            <a href={`/api/finance/clinic/${clinicId}/export`} className="button secondary">
              <Download size={17} />
              Export invoices
            </a>
            <button className="button primary" onClick={() => setModal('reconcile')}>
              <RefreshCw size={17} />
              Reconcile payments
            </button>
          </div>
        }
      />
      <div className="stats stats-three">
        {[
          [Wallet, 'Captured payments', f.capturedMinor],
          [Receipt, 'Net after refunds', f.netMinor],
          [Clock3, 'Outstanding invoices', f.dueMinor],
          [ArrowDownLeft, 'Processed refunds', f.refundedMinor],
          [ArrowUpRight, 'Refunds awaiting provider', f.pendingRefundMinor],
          [ShieldCheck, 'Ledger balance', f.ledgerDebitMinor - f.ledgerCreditMinor],
        ].map(([Icon, label, value]) => {
          const I = Icon as typeof Wallet;
          return (
            <div className="stat" key={String(label)}>
              <div className="stat-top">
                {String(label)}
                <span className="stat-icon">
                  <I size={18} />
                </span>
              </div>
              <div className="stat-value">{money(Number(value))}</div>
              <p className="small">
                {label === 'Ledger balance'
                  ? 'Total debits minus credits'
                  : 'Latest 500 payment records'}
              </p>
            </div>
          );
        })}
      </div>
      <div className="finance-grid">
        <section className="panel padded">
          <div className="section-row" style={{ marginTop: 0 }}>
            <div>
              <h2>Collected revenue</h2>
              <p className="small" style={{ marginTop: 6 }}>
                Last 14 days · BDT, net of completed refunds
              </p>
            </div>
            <span className="tag">{f.clinic.name}</span>
          </div>
          <div style={{ width: '100%', height: 270 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={f.trend} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f9b7d" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4f9b7d" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e4ece7" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => String(d).slice(5)}
                  tick={{ fontSize: 14, fill: '#7a8e83' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={25}
                />
                <YAxis
                  tickFormatter={(n) => `${Math.round(Number(n) / 100000)}k`}
                  tick={{ fontSize: 14, fill: '#7a8e83' }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(value) => [money(Number(value)), 'Net collected']}
                  contentStyle={{ fontSize: 14, borderRadius: 12, borderColor: '#dce8df' }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="revenueMinor"
                  stroke="#0d776e"
                  strokeWidth={2.5}
                  fill="url(#revenueGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel padded">
          <div className="section-row" style={{ marginTop: 0 }}>
            <h2>Billing policy</h2>
            <button
              className="icon-button"
              aria-label="Edit billing policy"
              onClick={() => setModal('policy')}
            >
              <Settings2 size={19} />
            </button>
          </div>
          <div className="policy-list">
            <div>
              <span>Full refund</span>
              <strong>Before {f.clinic.fullRefundHours} hours</strong>
            </div>
            <div>
              <span>Partial refund</span>
              <strong>
                {f.clinic.partialRefundPercent}% · {f.clinic.partialRefundHours}–
                {f.clinic.fullRefundHours}h
              </strong>
            </div>
            <div>
              <span>No-show grace</span>
              <strong>{f.clinic.noShowGraceMinutes} minutes</strong>
            </div>
            <div>
              <span>Tax rate</span>
              <strong>{(f.clinic.taxBasisPoints / 100).toFixed(2)}%</strong>
            </div>
            <div>
              <span>Payment policy</span>
              <strong>
                {f.clinic.allowPayLater ? 'Pay later allowed' : 'Payment before confirmation'}
              </strong>
            </div>
            <div>
              <span>Invoice prefix</span>
              <strong>{f.clinic.invoicePrefix}</strong>
            </div>
          </div>
          <p className="small" style={{ marginTop: 20 }}>
            Doctor cancellations receive a full refund. Held prices are retained when services or
            tax rates change.
          </p>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head">
          <h2>Clinic billing records</h2>
          <span className="small">{f.payments.length} payments</span>
        </div>
        <div className="tabs">
          {[
            ['payments', 'Payments & invoices'],
            ['ledger', 'Double-entry ledger'],
            ['reconcile', 'Reconciliation runs'],
            ['services', 'Service add-ons'],
          ].map(([key, label]) => (
            <button
              className={`tab ${tab === key ? 'active' : ''}`}
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'payments' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice / patient</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {f.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.appointment.invoice?.number || 'Consultation invoice'}</strong>
                      <small>
                        {p.appointment.patient.fullName} · {p.appointment.doctor.user.fullName}
                      </small>
                    </td>
                    <td>
                      <span className="tag">{p.provider}</span>
                    </td>
                    <td>
                      <strong>{money(p.amountMinor)}</strong>
                      {p.refundMinor > 0 && <small>Refund {money(p.refundMinor)}</small>}
                    </td>
                    <td>
                      <Badge status={p.status} />
                    </td>
                    <td>{dateLabel(p.createdAt)}</td>
                    <td>
                      <a
                        className="icon-button"
                        aria-label="Download consultation invoice"
                        href={`/api/payments/${p.appointment.id}/invoice`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download size={18} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'ledger' ? (
          <>
            <div className="ledger-balance">
              <ShieldCheck size={18} />
              <span>
                Debits {money(f.ledgerDebitMinor)} · Credits {money(f.ledgerCreditMinor)}
              </span>
              <strong>
                {f.ledgerDebitMinor === f.ledgerCreditMinor ? 'Balanced' : 'Review required'}
              </strong>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Journal</th>
                    <th>Account</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {f.ledger.slice(0, 100).map((e) => (
                    <tr key={e.id}>
                      <td>
                        <code>{e.journalId.slice(0, 30)}</code>
                      </td>
                      <td>{e.account.replaceAll('_', ' ')}</td>
                      <td>{e.side === 'DEBIT' ? money(e.amountMinor) : '—'}</td>
                      <td>{e.side === 'CREDIT' ? money(e.amountMinor) : '—'}</td>
                      <td>
                        {dateLabel(e.createdAt, {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : tab === 'reconcile' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Started</th>
                  <th>State</th>
                  <th>Checked</th>
                  <th>Repaired</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {f.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.provider}</td>
                    <td>
                      {dateLabel(r.startedAt, {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>{r.checked}</td>
                    <td>{r.repaired}</td>
                    <td>{r.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="service-manager">
            <div className="section-row" style={{ marginTop: 0 }}>
              <p className="small">Optional services patients can add while booking.</p>
              <button
                className="button secondary small"
                onClick={() => {
                  setEditing(null);
                  setName('');
                  setFee(500);
                  setModal('service');
                }}
              >
                <Plus size={16} />
                Add service
              </button>
            </div>
            {f.clinic.services.map((s) => (
              <div className="service-row" key={s.id}>
                <div>
                  <h3>{s.name}</h3>
                  <small>{s.active ? 'Available for booking' : 'Archived'}</small>
                </div>
                <strong>{money(s.feeMinor)}</strong>
                <button
                  className="button secondary small"
                  onClick={() => {
                    setEditing(s);
                    setName(s.name);
                    setFee(s.feeMinor / 100);
                    setModal('service');
                  }}
                >
                  Edit
                </button>
                <button
                  className={`button small ${s.active ? 'danger' : 'secondary'}`}
                  onClick={async () => {
                    try {
                      await api(`/finance/services/${s.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ active: !s.active }),
                      });
                      await query.refetch();
                      void client.invalidateQueries({ queryKey: ['clinic-services'] });
                    } catch (e) {
                      toast((e as Error).message, true);
                    }
                  }}
                >
                  {s.active ? 'Archive' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {modal === 'service' && (
        <Modal
          title={editing ? 'Edit clinic service' : 'Add a clinic service'}
          onClose={() => setModal(null)}
        >
          <form className="form-stack" onSubmit={service}>
            <label>
              Service name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </label>
            <label>
              Fee (BDT)
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
            <div className="form-actions">
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save service'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'policy' && (
        <Modal title="Clinic billing policy" wide onClose={() => setModal(null)}>
          <PolicyForm
            policy={f.clinic}
            clinicId={clinicId}
            onSaved={() => {
              void query.refetch();
              void client.invalidateQueries({ queryKey: ['clinics'] });
              setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === 'reconcile' && (
        <Modal title="Reconcile payment records" onClose={() => setModal(null)}>
          <div className="info-box">
            The worker checks up to 500 payments from the last 30 days against their provider.
            Verified captures and refunds repair local records and ledger entries. Demo
            reconciliation repairs the local ledger without contacting a financial provider.
          </div>
          <label style={{ marginTop: 20 }}>
            Payment provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.data?.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post(`/finance/clinic/${clinicId}/reconcile`, { provider });
                  await query.refetch();
                  setTab('reconcile');
                  setModal(null);
                  toast('Reconciliation queued. Progress will appear in the runs table.');
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Queue reconciliation
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function PolicyForm({
  policy,
  clinicId,
  onSaved,
}: {
  policy: Policy;
  clinicId: string;
  onSaved: () => void;
}) {
  const toast = useToast(),
    [value, setValue] = useState<Policy>({
      fullRefundHours: policy.fullRefundHours,
      partialRefundHours: policy.partialRefundHours,
      partialRefundPercent: policy.partialRefundPercent,
      noShowGraceMinutes: policy.noShowGraceMinutes,
      allowPayLater: policy.allowPayLater,
      taxBasisPoints: policy.taxBasisPoints,
      invoicePrefix: policy.invoicePrefix,
    }),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/finance/clinic/${clinicId}/policy`, {
            method: 'PATCH',
            body: JSON.stringify(value),
          });
          toast('Billing policy updated for new bookings.');
          onSaved();
        } catch (e) {
          toast((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {(
          [
            ['fullRefundHours', 'Full-refund threshold (hours)', 1, 720],
            ['partialRefundHours', 'Partial-refund threshold (hours)', 0, 720],
            ['partialRefundPercent', 'Partial refund (%)', 0, 100],
            ['noShowGraceMinutes', 'No-show grace (minutes)', 0, 180],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={value[key]}
              onChange={(e) => setValue({ ...value, [key]: Number(e.target.value) })}
              required
            />
          </label>
        ))}
        <label>
          Consultation tax (%)
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={value.taxBasisPoints / 100}
            onChange={(e) =>
              setValue({ ...value, taxBasisPoints: Math.round(Number(e.target.value) * 100) })
            }
            required
          />
        </label>
        <label>
          Invoice prefix
          <input
            value={value.invoicePrefix}
            onChange={(e) => setValue({ ...value, invoicePrefix: e.target.value.toUpperCase() })}
            pattern="[A-Z0-9]{1,10}"
            maxLength={10}
            required
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={value.allowPayLater}
          onChange={(e) => setValue({ ...value, allowPayLater: e.target.checked })}
        />
        <span>
          Allow appointments to be confirmed before payment. Otherwise, payment must complete within
          15 minutes.
        </span>
      </label>
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save billing policy'}
        </button>
      </div>
    </form>
  );
}
