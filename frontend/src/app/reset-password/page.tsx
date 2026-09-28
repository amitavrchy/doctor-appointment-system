'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useToast } from '@/components/providers';
export default function ResetPassword() {
  const router = useRouter(),
    toast = useToast();
  const [email, setEmail] = useState(''),
    [challenge, setChallenge] = useState(''),
    [code, setCode] = useState(''),
    [demo, setDemo] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Link className="brand" href="/">
          careflow.
        </Link>
        <h1>A fresh start for your account.</h1>
        <p>Verify your email code, then choose a new password.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              if (!challenge) {
                const r = await post<{ challengeId: string; demoCode?: string }>(
                  '/auth/password/request-reset',
                  { email },
                );
                setChallenge(r.challengeId);
                setDemo(r.demoCode || '');
              } else {
                await post('/auth/password/reset', {
                  challengeId: challenge,
                  code,
                  newPassword: password,
                });
                toast('Password reset. Sign in with your new password.');
                router.push('/login');
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!!challenge}
              autoComplete="email"
            />
          </label>
          {challenge && (
            <>
              <label>
                Verification code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              {demo && (
                <p className="warning-box">
                  Demo code: <strong>{demo}</strong>
                </p>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Please wait…' : challenge ? 'Reset password' : 'Send verification code'}
          </button>
        </form>
        <Link className="button ghost" href="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
