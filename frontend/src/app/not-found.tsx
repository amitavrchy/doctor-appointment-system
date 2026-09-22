import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">404 · A small detour</p>
        <h1>This page isn’t here.</h1>
        <p>Let’s get you back to your care.</p>
        <Link className="button primary" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
