import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace';
const sections = [
  'dashboard',
  'doctors',
  'appointments',
  'records',
  'billing',
  'telemedicine',
  'schedules',
  'clinics',
  'notifications',
  'settings',
  'analytics',
];
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <Workspace section={section} />;
}
