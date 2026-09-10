'use client';
export default function Error({reset}:{reset:()=>void}){return <main id="main" className="auth-page"><div className="auth-card"><h1>Something interrupted your visit.</h1><p>Your saved information is still there. Please try again.</p><button className="button primary" onClick={reset}>Try again</button></div></main>;}
