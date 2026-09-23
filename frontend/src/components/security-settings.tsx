'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ShieldCheck, KeyRound, Smartphone, Bell, Plus, LockKeyhole } from 'lucide-react';
import { api, post, dateLabel, localDate } from '@/lib/api';
import type { User, Doctor } from '@/lib/types';
import { Modal, Badge } from './ui';
import { useToast } from './providers';
type Preference = {
  email: boolean;
  sms: boolean;
  inApp: boolean;
  reminders: boolean;
  followUps: boolean;
};
export function SecuritySettings({
  user,
  onPhoneVerified,
}: {
  user: User;
  onPhoneVerified?: (phone: string) => void;
}) {
  const toast = useToast(),
    client = useQueryClient(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [modal, setModal] = useState<'phone' | 'password' | 'pin' | 'consent' | null>(null),
    [phone, setPhone] = useState(user.phone || ''),
    [challenge, setChallenge] = useState(''),
    [demoCode, setDemoCode] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [pin, setPin] = useState(''),
    [doctorId, setDoctorId] = useState(''),
    [expiry, setExpiry] = useState(localDate(30));
  const pref = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<Preference>('/preferences/notifications'),
  });
  const grants = useQuery({
    queryKey: ['consents'],
    queryFn: () =>
      api<
        { id: string; doctor: { fullName: string }; expiresAt: string; revokedAt: string | null }[]
      >('/consents'),
  });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
  const signing = useQuery({
    queryKey: ['signing-status'],
    queryFn: () => api<{ configured: boolean }>('/clinical/signing-status'),
    enabled: !!user.doctor,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal === 'phone' && !challenge) {
        const result = await post<{ challengeId: string; demoCode?: string }>(
          '/auth/phone/request',
          { phone },
        );
        setChallenge(result.challengeId);
        setDemoCode(result.demoCode || '');
        return;
      }
      if (modal === 'phone') {
        await post('/auth/phone/verify', { challengeId: challenge, code });
        onPhoneVerified?.(phone);
        await client.invalidateQueries({ queryKey: ['me'] });
        toast('Your phone is verified and ready for code sign-in.');
        setChallenge('');
      }
      if (modal === 'password') {
        await post('/auth/password', { currentPassword: password, newPassword });
        client.clear();
        toast('Password updated. Please sign in with your new password.');
        router.push('/login');
      }
      if (modal === 'pin') {
        await post('/clinical/signing-pin', { password, pin });
        await signing.refetch();
        toast('Your signing PIN is ready.');
      }
      if (modal === 'consent') {
        await post('/consents', {
          doctorId: doctorId || doctors.data?.[0]?.userId,
          expiresAt: `${expiry}T23:59:00+06:00`,
        });
        await grants.refetch();
        toast('Doctor-specific consent granted.');
      }
      setModal(null);
      setPassword('');
      setNewPassword('');
      setPin('');
      setCode('');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="security-grid">
      <section className="panel security-panel">
        <h2>
          <ShieldCheck size={21} style={{ verticalAlign: 'middle', marginRight: 9 }} />
          Account security
        </h2>
        <p>
          Manage verified sign-in methods and private signing credentials. Revoked device sessions
          lose access immediately.
        </p>
        <div className="security-actions">
          <div>
            <Smartphone size={24} />
            <h3>Verified phone sign-in</h3>
            <p>Receive a sign-in code on a verified phone number.</p>
            <button
              className="button secondary"
              onClick={() => {
                setModal('phone');
                setChallenge('');
                setDemoCode('');
              }}
            >
              Verify a phone number
            </button>
          </div>
          <div>
            <KeyRound size={24} />
            <h3>Password & device access</h3>
            <p>Changing your password signs out every device.</p>
            <button className="button secondary" onClick={() => setModal('password')}>
              Change password
            </button>
          </div>
          {user.doctor && (
            <div>
              <LockKeyhole size={24} />
              <h3>Prescription signing PIN</h3>
              <p>
                {signing.data?.configured
                  ? 'Your six-digit signing PIN is configured.'
                  : 'Set a separate six-digit PIN to authorize prescription signatures.'}
              </p>
              <button className="button secondary" onClick={() => setModal('pin')}>
                {signing.data?.configured ? 'Change signing PIN' : 'Set signing PIN'}
              </button>
            </div>
          )}
        </div>
      </section>
      <div className="setting-grid">
        <section className="panel security-panel">
          <h2>How you hear from us</h2>
          <p>Choose notification channels and the care updates you want.</p>
          {pref.error && <p className="form-error">{pref.error.message}</p>}
          {pref.data &&
            Object.entries({
              email: ['Email updates', 'Booking and care updates by email.'],
              sms: ['SMS updates', 'Requires a verified phone and configured SMS gateway.'],
              inApp: ['In-app updates', 'Keep a notification history in your workspace.'],
              reminders: [
                'Appointment reminders',
                'A reminder before your scheduled consultation.',
              ],
              followUps: ['Post-visit follow-ups', 'A check-in after your consultation.'],
            }).map(([key, [label, description]]) => (
              <label className="preference-row" key={key}>
                <span>
                  <h4>{label}</h4>
                  <p>{description}</p>
                </span>
                <input
                  type="checkbox"
                  checked={pref.data[key as keyof Preference]}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await api('/preferences/notifications', {
                        method: 'PATCH',
                        body: JSON.stringify({ ...pref.data, [key]: e.target.checked }),
                      });
                      await pref.refetch();
                      toast('Notification preference saved.');
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            ))}
        </section>
        <section className="panel security-panel">
          <div className="section-row" style={{ marginTop: 0 }}>
            <h2>Doctor-specific consent</h2>
            <button className="button secondary small" onClick={() => setModal('consent')}>
              <Plus size={16} />
              Grant access
            </button>
          </div>
          <p>
            Allow one treating doctor to access your history across clinics until a date you choose.
            You can revoke access at any time.
          </p>
          {grants.error && <p className="form-error">{grants.error.message}</p>}
          {grants.data?.length ? (
            grants.data.map((grant) => (
              <div className="consent-row" key={grant.id}>
                <div>
                  <h4>{grant.doctor.fullName}</h4>
                  <p className="small">Expires {dateLabel(grant.expiresAt)}</p>
                  <Badge
                    status={
                      grant.revokedAt
                        ? 'REVOKED'
                        : new Date(grant.expiresAt) < new Date()
                          ? 'EXPIRED'
                          : 'ACTIVE'
                    }
                  />
                </div>
                {!grant.revokedAt && (
                  <button
                    className="button danger small"
                    onClick={async () => {
                      try {
                        await api(`/consents/${grant.id}`, { method: 'DELETE' });
                        await grants.refetch();
                        toast('Consent revoked.');
                      } catch (e) {
                        toast((e as Error).message, true);
                      }
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="info-box">
              No doctor-specific cross-clinic grants. Your general sharing preference above still
              applies.
            </div>
          )}
        </section>
      </div>
      {modal && (
        <Modal
          title={
            modal === 'phone'
              ? 'Verify your phone'
              : modal === 'password'
                ? 'Change your password'
                : modal === 'pin'
                  ? 'Set your signing PIN'
                  : 'Grant time-limited doctor access'
          }
          onClose={() => setModal(null)}
        >
          <form className="form-stack" onSubmit={submit}>
            {modal === 'phone' && (
              <>
                <label>
                  Phone number (international format)
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+8801XXXXXXXXX"
                    pattern="\+[1-9][0-9]{6,14}"
                    required
                    disabled={!!challenge}
                  />
                </label>
                {challenge && (
                  <label>
                    Verification code
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      pattern="[0-9]{6}"
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                    />
                  </label>
                )}
                {demoCode && (
                  <p className="warning-box">
                    Demo verification code: <strong>{demoCode}</strong>
                  </p>
                )}
              </>
            )}
            {(modal === 'password' || modal === 'pin') && (
              <label>
                Current account password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
            )}
            {modal === 'password' && (
              <>
                <label>
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <p className="warning-box">
                  Every current device session will be revoked. Sign in again after saving.
                </p>
              </>
            )}
            {modal === 'pin' && (
              <label>
                Six-digit signing PIN
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  pattern="[0-9]{6}"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
              </label>
            )}
            {modal === 'consent' && (
              <>
                <label>
                  Doctor
                  <select
                    value={doctorId || doctors.data?.[0]?.userId || ''}
                    onChange={(e) => setDoctorId(e.target.value)}
                    required
                  >
                    {doctors.data?.map((d) => (
                      <option key={d.userId} value={d.userId}>
                        {d.user.fullName} · {d.specialties[0]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Access expires on
                  <input
                    type="date"
                    value={expiry}
                    min={localDate(1)}
                    max={localDate(365)}
                    onChange={(e) => setExpiry(e.target.value)}
                    required
                  />
                </label>
                <div className="info-box">
                  The doctor must have a treating relationship with you. This grant allows
                  cross-clinic history access and does not grant account or payment access.
                </div>
              </>
            )}
            <div className="form-actions">
              <button className="button primary" disabled={busy}>
                {busy
                  ? 'Saving…'
                  : modal === 'phone' && !challenge
                    ? 'Send verification code'
                    : modal === 'phone'
                      ? 'Verify phone'
                      : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
