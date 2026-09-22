'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui';
export default function Verify() {
  const [code, setCode] = useState(''),
    [submitted, setSubmitted] = useState(() =>
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('code') || ''
        : '',
    );
  const query = useQuery({
    queryKey: ['verify', submitted],
    queryFn: () =>
      api<{
        status: string;
        doctor: string;
        license: string;
        clinic: string;
        signedAt: string | null;
      }>(`/prescriptions/verify/${encodeURIComponent(submitted)}`),
    enabled: !!submitted,
    retry: false,
  });
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Link href="/" className="brand">
          careflow.
        </Link>
        <h1>Verify a prescription</h1>
        <p>Check authenticity without exposing patient or medication details.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(code);
          }}
        >
          <label>
            Verification code
            <input value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <button className="button primary" disabled={query.isFetching}>
            Verify prescription
          </button>
        </form>
        {query.error && (
          <p className="form-error" style={{ marginTop: 20 }}>
            {query.error.message}
          </p>
        )}
        {query.data && (
          <div className="info-box" style={{ marginTop: 20 }}>
            <Badge status={query.data.status} />
            <p style={{ marginTop: 12 }}>
              {query.data.doctor}
              <br />
              {query.data.license}
              <br />
              {query.data.clinic}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
