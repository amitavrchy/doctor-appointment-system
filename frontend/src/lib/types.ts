export type User = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  globalRole: string;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  allergies: string[];
  consentHistory: boolean;
  emergencyContact: { name: string; phone: string } | null;
  roles: { clinicId: string; role: string }[];
  doctor: { specialties: string[] } | null;
};
export type Clinic = {
  id: string;
  name: string;
  slug: string;
  address: string;
  timezone: string;
  rooms: { id: string; name: string }[];
  _count?: { doctors: number };
};
export type Doctor = {
  userId: string;
  user: { id: string; fullName: string };
  specialties: string[];
  licenseNumber: string;
  bio: string;
  languages: string[];
  color: string;
  memberships: { clinicId: string; feeMinor: number; teleFeeMinor: number; clinic: Clinic }[];
};
export type Payment = {
  id: string;
  status: string;
  amountMinor: number;
  refundMinor: number;
  provider: string;
  currency: string;
};
export type Medication = {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  route: string;
  instructions: string;
};
export type Prescription = {
  id: string;
  status: string;
  items: Medication[];
  signedAt: string | null;
  verificationCode: string;
};
export type Note = {
  id: string;
  soap: { subjective: string; objective: string; assessment: string; plan: string };
  createdAt: string;
  revisions: unknown[];
};
export type Appointment = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  clinic: Clinic;
  doctor: Doctor;
  patient: { id: string; fullName: string; email: string };
  status: string;
  type: string;
  startAt: string;
  endAt: string;
  feeMinor: number;
  reason: string | null;
  payment: Payment | null;
  teleSession: { id: string; status: string } | null;
  notes?: Note[];
  prescription?: Prescription | null;
};
export type Slot = {
  startAt: string;
  endAt: string;
  feeMinor: number;
  type: string;
  available: boolean;
};
export type Hold = { id: string; expiresAt: string; feeMinor: number; startAt: string };
export type Notification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};
export type Summary = {
  total: number;
  completed: number;
  noShow: number;
  revenueMinor: number;
  noShowRate: number;
  averageWaitMinutes: number;
  byDay: { date: string; count: number }[];
  completionRate: number;
};
