'use client';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, CheckCircle2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { api, post, dateLabel } from '@/lib/api';
import { PageHeading, Loading, ErrorState, Badge } from '../ui';
import { useToast } from '../providers';
type Monitor = {
  counts: Record<string, number>;
  workerRunning: boolean;
  pendingOutbox: number;
  jobs: {
    id: string;
    name: string;
    state: string;
    attempts: number;
    createdAt: string;
    processedAt: string | null;
    finishedAt: string | null;
    failed: boolean;
  }[];
};
export function JobMonitor() {
  const toast = useToast(),
    query = useQuery({
      queryKey: ['jobs'],
      queryFn: () => api<Monitor>('/jobs'),
      refetchInterval: 5000,
    });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const m = query.data;
  return (
    <>
      <PageHeading
        eyebrow="Platform operations"
        title="The work behind every visit."
        description="Monitor delayed reminders, PDF generation, refunds, reconciliation, and durable notification delivery."
        action={
          <button className="button secondary" onClick={() => void query.refetch()}>
            <RefreshCw size={17} />
            Refresh now
          </button>
        }
      />
      <div className="operations-banner">
        <span className={`live-indicator ${m.workerRunning ? '' : 'offline'}`}>
          <i />
          {m.workerRunning ? 'Worker is running' : 'Worker is not running'}
        </span>
        <span>
          <Layers size={17} />
          {m.pendingOutbox} outbox events awaiting delivery
        </span>
        <p>Automatically refreshes every 5 seconds</p>
      </div>
      <div className="stats">
        {[
          [Clock3, 'Waiting', (m.counts.waiting || 0) + (m.counts.delayed || 0)],
          [Activity, 'Active', m.counts.active || 0],
          [CheckCircle2, 'Completed', m.counts.completed || 0],
          [AlertCircle, 'Failed', m.counts.failed || 0],
        ].map(([Icon, label, count]) => {
          const I = Icon as typeof Clock3;
          return (
            <div className="stat" key={String(label)}>
              <div className="stat-top">
                {String(label)}
                <span className="stat-icon">
                  <I size={19} />
                </span>
              </div>
              <div className="stat-value">{String(count)}</div>
              <p className="small">Durable Redis queue</p>
            </div>
          );
        })}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Background jobs</h2>
          <span className="small">Operational metadata only</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>State</th>
                <th>Attempts</th>
                <th>Created</th>
                <th>Finished</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {m.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.name.replaceAll('-', ' ')}</strong>
                    <small>
                      <code>{job.id.slice(0, 38)}</code>
                    </small>
                  </td>
                  <td>
                    <Badge status={job.state} />
                  </td>
                  <td>{job.attempts}</td>
                  <td>
                    {dateLabel(job.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    {job.finishedAt
                      ? dateLabel(job.finishedAt, {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td>
                    {job.state === 'failed' ? (
                      <button
                        className="button secondary small"
                        onClick={async () => {
                          try {
                            await post(`/jobs/${encodeURIComponent(job.id)}/retry`);
                            await query.refetch();
                            toast('Job queued for another attempt.');
                          } catch (e) {
                            toast((e as Error).message, true);
                          }
                        }}
                      >
                        <RefreshCw size={15} />
                        Retry job
                      </button>
                    ) : (
                      <span className="small">{job.state === 'delayed' ? 'Scheduled' : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="info-box" style={{ marginTop: 24 }}>
        Clinical message bodies, recipient addresses, gateway secrets, and raw provider responses
        are excluded from this view. Failed jobs retain retry metadata. Provider refunds stay
        pending until the provider confirms completion.
      </div>
    </>
  );
}
