'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HeartPulse, ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react';
import { post } from '@/lib/api';
export function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter(),
    client = useQueryClient();
  const [ready, setReady] = useState(false),
    [nextPath, setNextPath] = useState('/dashboard');
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next?.startsWith('/')) {
      const target = new URL(next, window.location.origin);
      if (
        target.origin === window.location.origin &&
        /^\/(doctors|appointments|dashboard|calendar|records|care-plans|clinical|billing|telemedicine|settings)$/.test(
          target.pathname,
        )
      )
        setNextPath(target.pathname + target.search);
    }
    setReady(true);
  }, []);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [fullName, setFullName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [otpMode, setOtpMode] = useState(false),
    [smsMode, setSmsMode] = useState(false),
    [challenge, setChallenge] = useState(''),
    [code, setCode] = useState(''),
    [demoCode, setDemoCode] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (register) {
        await post('/auth/register', { email, password, fullName });
        await post('/auth/login', { email, password });
      } else if (otpMode && !challenge) {
        const result = await post<{ challengeId: string; demoCode?: string }>(
          '/auth/otp/request',
          smsMode ? { phone: email } : { email },
        );
        setChallenge(result.challengeId);
        setDemoCode(result.demoCode || '');
        setBusy(false);
        return;
      } else if (otpMode) await post('/auth/otp/verify', { challengeId: challenge, code });
      else await post('/auth/login', { email, password });
      client.clear();
      router.push(nextPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Link href="/" className="auth-back-home">
          <ArrowLeft size={17} />
          Back to home
        </Link>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <HeartPulse />
          </span>
          careflow.
        </Link>
        <p className="eyebrow">Your next chapter of better health</p>
        <h1>{register ? 'A healthier everyday starts here.' : 'Welcome back.'}</h1>
        <p>
          {register
            ? 'A few details, and your care is connected.'
            : 'A little less managing. A little more living well.'}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label>
              Full name
              <input
                disabled={!ready}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            {smsMode ? 'Verified mobile number' : 'Email address'}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type={smsMode ? 'tel' : 'email'}
              pattern={smsMode ? '\\+[1-9][0-9]{6,14}' : undefined}
              required
              autoComplete="email"
              placeholder="you@example.com"
              disabled={!ready || !!challenge}
            />
          </label>
          {(!otpMode || register) && (
            <label>
              Password
              <input
                disabled={!ready}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={register ? 12 : 1}
                maxLength={128}
                required
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={register ? 'At least 12 characters' : 'Your password'}
              />
            </label>
          )}
          {otpMode && challenge && (
            <>
              <label>
                6-digit verification code
                <input
                  disabled={!ready}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              {demoCode && (
                <div className="warning-box">
                  Demo verification code: <strong>{demoCode}</strong>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={!ready || busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                {register
                  ? 'Create your account'
                  : otpMode && !challenge
                    ? 'Send sign-in code'
                    : 'Sign in'}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="auth-links">
          <Link
            className="text-link"
            href={`${register ? '/login' : '/register'}${nextPath !== '/dashboard' ? `?next=${encodeURIComponent(nextPath)}` : ''}`}
          >
            {register ? 'Already have an account?' : 'New here? Create an account'}
          </Link>
          {!register && (
            <button
              className="text-link"
              onClick={() => {
                setOtpMode(!otpMode);
                setSmsMode(false);
                if (smsMode) setEmail('');
                setChallenge('');
                setError('');
              }}
            >
              {otpMode ? 'Use password' : 'Use email code'}
            </button>
          )}
        </div>
        {!register && (
          <div className="auth-links">
            <button
              className="text-link"
              onClick={() => {
                setOtpMode(true);
                setSmsMode(true);
                setEmail('');
                setChallenge('');
                setError('');
              }}
            >
              Use a verified phone code
            </button>
            <Link className="text-link" href="/reset-password">
              Forgot password?
            </Link>
          </div>
        )}
        {!register && (
          <div className="demo-accounts">
            <p>Explore with a demo account</p>
            <div className="demo-options">
              {[
                ['Patient', 'patient'],
                ['Doctor', 'sara'],
                ['Admin', 'admin'],
                ['Reception', 'reception'],
              ].map(([label, user]) => (
                <button
                  key={user}
                  disabled={!ready}
                  onClick={() => {
                    setEmail(`${user}@careflow.demo`);
                    setPassword('CareflowDemo2026!');
                    setOtpMode(false);
                    setSmsMode(false);
                    setChallenge('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 14, marginTop: 12 }}>
              Synthetic data · Demo payments · No real care is provided.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
