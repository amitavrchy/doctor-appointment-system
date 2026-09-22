'use client';
import { useEffect, useId, useRef } from 'react';
import { X, LoaderCircle, ArrowUpRight, CalendarDays } from 'lucide-react';
import Link from 'next/link';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={28} />
      <span>Getting everything ready…</span>
    </div>
  );
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <CalendarDays size={28} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && (
        <Link className="button primary" href={action.href}>
          {action.label}
          <ArrowUpRight size={18} />
        </Link>
      )}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <h3>We couldn’t load this just yet</h3>
      <p>{error.message}</p>
      <button className="button secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      <i />
      {status.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
export function Avatar({
  name,
  color = 'teal',
  large = false,
}: {
  name: string;
  color?: string;
  large?: boolean;
}) {
  const words = name.replace(/^Dr\.\s*/, '').split(' ');
  return (
    <span className={`avatar ${color} ${large ? 'large' : ''}`} aria-hidden="true">
      {words
        .slice(0, 2)
        .map((w) => w[0])
        .join('')}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
