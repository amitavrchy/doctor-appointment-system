'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
export function PatientQueue() {
  const query = useQuery({
    queryKey: ['my-queue'],
    queryFn: () =>
      api<
        {
          appointmentId: string;
          clinic: string;
          number: number | null;
          status: string;
          position: number;
        }[]
      >('/queue/mine'),
    refetchInterval: 15000,
  });
  if (!query.data?.length) return null;
  return (
    <section className="patient-queue-banner" aria-live="polite">
      {query.data.map((q) => (
        <div className="patient-queue-item" key={q.appointmentId}>
          <span className="stat-icon">
            <Users size={22} />
          </span>
          <div>
            <strong>
              {q.status === 'IN_PROGRESS'
                ? 'Your doctor is ready'
                : `You are number ${q.position} in the waiting queue`}
            </strong>
            <p>
              {q.clinic}
              {q.number ? ` · Ticket ${String(q.number).padStart(3, '0')}` : ''}
            </p>
            <span className="small">Queue order may change for urgent care.</span>
          </div>
          <Link
            className="button secondary small"
            href={`/appointments?appointment=${q.appointmentId}`}
          >
            View visit
            <ArrowUpRight size={16} />
          </Link>
        </div>
      ))}
    </section>
  );
}
