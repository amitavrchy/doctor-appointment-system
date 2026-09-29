import { LandingPage } from '@/components/landing-page';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Care that sees the whole you',
  description:
    'Explore doctors, specialties, clinic locations and consultation fees. Book your next visit and keep appointments, prescriptions and care plans connected with Careflow.',
};
export default function Home() {
  return <LandingPage />;
}
