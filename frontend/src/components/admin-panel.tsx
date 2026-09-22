'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from './providers';
import { Badge, Modal } from './ui';
export function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [q, setQ] = useState(''),
    [target, setTarget] = useState<{
      id: string;
      fullName: string;
      deletedAt: string | null;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['admin-users', q],
    queryFn: () =>
      api<
        {
          id: string;
          fullName: string;
          email: string;
          globalRole: string;
          deletedAt: string | null;
        }[]
      >(`/admin/users?q=${encodeURIComponent(q)}`),
  });
  const flags = useQuery({
    queryKey: ['features'],
    queryFn: () => api<Record<string, boolean>>('/features'),
  });
  return (
    <>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head">
          <div>
            <h2>Platform users</h2>
            <p>Clinical records are retained when an account is deactivated.</p>
          </div>
          <input
            style={{ maxWidth: 240 }}
            aria-label="Search platform users"
            placeholder="Search people…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {query.error && <p className="form-error">{query.error.message}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Platform role</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.fullName}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      aria-label={`Platform role for ${u.fullName}`}
                      value={u.globalRole}
                      disabled={u.id === currentUserId || busy}
                      onChange={async (e) => {
                        setBusy(true);
                        try {
                          await api(`/admin/users/${u.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ globalRole: e.target.value }),
                          });
                          await query.refetch();
                          toast('Platform role updated.');
                        } catch (e) {
                          toast((e as Error).message, true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <option value="PATIENT">Patient / clinic member</option>
                      <option value="SUPER_ADMIN">Platform administrator</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className={`button small ${u.deletedAt ? 'secondary' : 'danger'}`}
                      disabled={u.id === currentUserId}
                      onClick={() => setTarget(u)}
                    >
                      {u.deletedAt ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel setting-section" style={{ marginTop: 24 }}>
        <h2>Platform features</h2>
        {Object.entries(flags.data || {}).map(([key, enabled]) => (
          <label key={key} className="check" style={{ marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await api(`/admin/flags/${key}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: e.target.checked }),
                  });
                  await flags.refetch();
                  toast('Feature availability updated.');
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <span>
              {key === 'TELEMEDICINE_ENABLED' ? 'Telemedicine booking' : 'Appointment waitlist'}
            </span>
          </label>
        ))}
      </section>
      {target && (
        <Modal
          title={target.deletedAt ? 'Restore account access?' : 'Deactivate this account?'}
          onClose={() => setTarget(null)}
        >
          <p>
            {target.fullName}{' '}
            {target.deletedAt
              ? 'will be able to sign in again.'
              : 'will lose sign-in access. Existing appointments and clinical records will be retained.'}
          </p>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setTarget(null)}>
              Keep current access
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/admin/users/${target.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: !!target.deletedAt }),
                  });
                  await query.refetch();
                  toast('Account access updated.');
                  setTarget(null);
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm change
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
