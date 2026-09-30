'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  HeartPulse,
  Menu,
  X,
  Search,
  MapPin,
  Check,
  CalendarCheck2,
  Clock3,
  ShieldCheck,
  Video,
  FileHeart,
  Stethoscope,
  Heart,
  Plus,
  LockKeyhole,
  ClipboardCheck,
  Building2,
  CircleCheck,
  Languages,
  FolderHeart,
} from 'lucide-react';
import { api, money } from '@/lib/api';
import type { Doctor, Clinic } from '@/lib/types';
import { Avatar } from './ui';
import s from './landing-page.module.css';

const specialties = ['General Medicine', 'Cardiology', 'Dermatology', 'Neurology', 'Pediatrics'];
const journey = [
  {
    title: 'Find your person.',
    body: 'Explore specialties, clinic locations, languages, and consultation fees. Choose a doctor who fits your needs.',
    icon: Search,
  },
  {
    title: 'Make a little time.',
    body: 'Pick an available appointment. We hold your time for three minutes while you review the details and confirm.',
    icon: CalendarCheck2,
  },
  {
    title: 'Keep care connected.',
    body: 'Come back to your prescriptions, test results, care plans, and follow-up tasks whenever you need them.',
    icon: FolderHeart,
  },
];
const tabs = [
  {
    label: 'Before your visit',
    title: 'Arrive with a little less on your mind.',
    body: 'A clear appointment, the right clinic, and your care details together. Make room for the conversation that matters.',
    items: [
      'See consultation fees before booking',
      'Choose a clinic or an online visit',
      'Find your appointment details in one place',
    ],
    steps: ['Choose your care team', 'Reserve an available time', 'Review & confirm your visit'],
  },
  {
    label: 'During your visit',
    title: 'More connection. More time for you.',
    body: 'Check in, follow your place in the queue, or enter your private online waiting room. Your doctor takes it from there.',
    items: [
      'Follow your position after check-in',
      'Meet your doctor in person or online',
      'Keep clinical notes with your consultation',
    ],
    steps: [
      'Check in for your visit',
      'Your doctor is ready',
      'Have a conversation about your care',
    ],
  },
  {
    label: 'After your visit',
    title: 'Good care keeps going.',
    body: 'The next step should feel clear. Keep your prescriptions, reviewed results, and agreed care plan close at hand.',
    items: [
      'Download your prescription and invoice',
      'Follow care-plan tasks at your pace',
      'Review laboratory results and referrals',
    ],
    steps: [
      'Revisit your care notes',
      'Follow your agreed care plan',
      'Make time for your next review',
    ],
  },
];
const faqs = [
  [
    'How do I book my first appointment?',
    'Choose a specialty or clinic below, explore the doctor profiles, and select a time. Sign in or create an account to reserve and confirm your visit. Your selected time is held for three minutes while you finish.',
  ],
  [
    'Can I see a doctor online?',
    'Yes. Doctors who offer telemedicine have online appointment options. Your private room opens 15 minutes before the visit, and your doctor admits you when they are ready. Online availability and enabled video services depend on the clinic.',
  ],
  [
    'Will I see the fee before I book?',
    'Yes. You can see consultation fees on doctor profiles. Your booking summary includes selected service add-ons, any clinic tax, and the total before confirmation. Payment timing depends on the clinic policy.',
  ],
  [
    'What if I need to cancel or reschedule?',
    'Open the appointment in your workspace to review your options. Your booking shows the applicable refund policy; eligibility depends on the clinic and how much time remains before the visit.',
  ],
  [
    'Who can see my health records?',
    'Your own records and your treating doctor’s access are protected by account and clinic permissions. Sharing history across clinics is your choice. You can manage general sharing and time-limited access for a specific doctor in Settings.',
  ],
  [
    'Is this a live healthcare service?',
    'Careflow is a demonstration platform with illustrative profiles and synthetic care records. You can explore the complete booking and care experience. Live payments, messages, and video require the clinic’s configured services.',
  ],
];

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false),
    [tab, setTab] = useState(0);
  const [specialty, setSpecialty] = useState(''),
    [clinicId, setClinicId] = useState(''),
    [resultPage, setResultPage] = useState(1);
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') });
  const clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api<Clinic[]>('/clinics') });
  const filtered = (doctors.data || []).filter(
    (d) =>
      (!specialty || d.specialties.includes(specialty)) &&
      (!clinicId || d.memberships.some((m) => m.clinicId === clinicId)),
  );
  const pageSize = 3;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(resultPage, pageCount);
  const firstResult = (currentPage - 1) * pageSize;
  const visibleDoctors = filtered.slice(firstResult, firstResult + pageSize);
  const pageNumbers = Array.from(
    { length: Math.min(5, pageCount) },
    (_, i) => Math.min(Math.max(currentPage - 2, 1), Math.max(pageCount - 4, 1)) + i,
  );
  useEffect(() => {
    const elements = root.current?.querySelectorAll('[data-reveal]');
    if (!elements || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(s.revealed);
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);
  function discover(nextSpecialty = specialty, nextClinic = clinicId) {
    setSpecialty(nextSpecialty);
    setClinicId(nextClinic);
    setResultPage(1);
    setMenu(false);
    scrollToResults();
  }
  function scrollToResults() {
    requestAnimationFrame(() => {
      const heading = document.getElementById('doctor-results');
      heading?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
      heading?.focus({ preventScroll: true });
    });
  }
  function changePage(page: number) {
    setResultPage(page);
    scrollToResults();
  }
  const active = tabs[tab];
  return (
    <div className={s.page} ref={root} data-testid="landing-page">
      <div className={s.announcement}>
        <span>A LITTLE MORE CONNECTED. A LITTLE MORE YOU.</span>
        <span>
          <span className={s.dot} />
          In person & online
        </span>
      </div>
      <header className={s.header}>
        <div className={s.nav}>
          <Link className="brand" href="/" aria-label="Careflow home">
            <span className="brand-mark">
              <HeartPulse />
            </span>
            careflow<span className={s.brandDot}>.</span>
          </Link>
          <nav
            className={`${s.navLinks} ${menu ? s.navOpen : ''}`}
            aria-label="Main navigation"
            id="home-navigation"
          >
            <a href="#specialists" onClick={() => setMenu(false)}>
              Find your care
            </a>
            <a href="#experience" onClick={() => setMenu(false)}>
              The Careflow way
            </a>
            <a href="#how-it-works" onClick={() => setMenu(false)}>
              How it works
            </a>
            <a href="#questions" onClick={() => setMenu(false)}>
              FAQs
            </a>
            <Link href="/login" className={s.mobileSignIn}>
              Sign in <ArrowUpRight size={16} />
            </Link>
          </nav>
          <div className={s.navActions}>
            <Link href="/login" className={s.signIn}>
              Sign in
            </Link>
            <Link href="/register" className={s.button}>
              Get started <ArrowUpRight size={17} />
            </Link>
            <button
              className={s.menuButton}
              aria-label={menu ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menu}
              aria-controls="home-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <section className={`${s.hero} ${s.container}`}>
          <div className={s.heroCopy}>
            <div className={s.eyebrow}>
              <span className={s.dot} />
              HEALTHCARE, WITH A HUMAN TOUCH
            </div>
            <h1>
              Care that sees
              <br />
              the <em>whole you.</em>
            </h1>
            <p>
              Your health is a story, not a single appointment. Find the right doctor, make time for
              yourself, and keep every chapter of your care connected.
            </p>
            <div className={s.heroActions}>
              <a href="#specialists" className={s.button}>
                Find your care <ArrowUpRight size={19} />
              </a>
              <a href="#how-it-works" className={s.textLink}>
                A simpler way to start{' '}
                <span className={s.roundArrow}>
                  <ArrowRight size={18} />
                </span>
              </a>
            </div>
            <div className={s.heroNote}>
              <span className={s.noteIcon}>
                <HeartPulse size={22} />
              </span>
              <div>
                <strong>Your time. Your choice. Your wellbeing.</strong>
                <span>In-clinic visits and online consultations, together.</span>
              </div>
            </div>
          </div>
          <div className={s.heroVisual}>
            <div className={s.imageFrame}>
              <Image
                src="/images/doctor.jpg"
                alt="A clinician in a white coat, standing in a sunlit garden"
                fill
                preload
                sizes="(max-width: 760px) 92vw, 48vw"
                className={s.heroImage}
              />
              <div className={s.imageShade} />
              <span className={s.photoTag}>
                <span className={s.dot} />
                PEOPLE FIRST. ALWAYS.
              </span>
              <div className={s.photoWords}>
                A little more
                <br />
                <em>human.</em>
              </div>
            </div>
            <div className={s.orbitBadge}>
              <HeartPulse size={29} />
              <span>
                CARE THAT
                <br />
                COMES
                <br />
                TOGETHER
              </span>
            </div>
            <div className={s.appointmentPreview}>
              <span className={s.previewIcon}>
                <CalendarCheck2 size={24} />
              </span>
              <div>
                <span className={s.overline}>LESS TO MANAGE</span>
                <strong>More room for feeling better.</strong>
                <p>Appointments, records & your next steps.</p>
              </div>
              <CircleCheck size={23} className={s.checkIcon} />
            </div>
            <span className={s.visualCaption}>Thoughtfully connected, every step of the way.</span>
          </div>
        </section>
        <div className={`${s.container} ${s.searchWrap}`}>
          <form
            className={s.searchBar}
            onSubmit={(e) => {
              e.preventDefault();
              discover();
            }}
          >
            <div className={s.searchIntro}>
              <Search size={23} />
              <div>
                <strong>Let’s find your care.</strong>
                <span>A good place to begin.</span>
              </div>
            </div>
            <label>
              <span>Specialty</span>
              <select
                aria-label="Specialty"
                value={specialty}
                onChange={(e) => {
                  setSpecialty(e.target.value);
                  setResultPage(1);
                }}
              >
                <option value="">All specialties</option>
                {specialties.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Clinic location</span>
              <select
                aria-label="Clinic location"
                value={clinicId}
                onChange={(e) => {
                  setClinicId(e.target.value);
                  setResultPage(1);
                }}
              >
                <option value="">All locations</option>
                {clinics.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={s.button} type="submit">
              Explore doctors <ArrowUpRight size={19} />
            </button>
          </form>
        </div>
        <section
          id="specialists"
          className={`${s.resultsSection} ${s.container}`}
          aria-labelledby="doctor-results"
        >
          <div className={s.directoryHead}>
            <div>
              <h2 id="doctor-results" tabIndex={-1}>
                {specialty || 'Meet your care team'}
              </h2>
              <span aria-live="polite">
                {doctors.isPending
                  ? 'Finding your care team…'
                  : `${filtered.length} doctor${filtered.length === 1 ? '' : 's'}${clinicId ? ` at ${clinics.data?.find((c) => c.id === clinicId)?.name || 'your selected clinic'}` : ' across our clinics'}`}
              </span>
            </div>
            {(specialty || clinicId) && (
              <button
                className={s.textLink}
                onClick={() => {
                  setSpecialty('');
                  setClinicId('');
                  setResultPage(1);
                }}
              >
                Clear filters <X size={15} />
              </button>
            )}
          </div>
          {doctors.error ? (
            <div className={s.directoryState}>
              <p>We couldn’t load the directory just yet.</p>
              <button className={s.textLink} onClick={() => void doctors.refetch()}>
                Try again <ArrowRight size={16} />
              </button>
            </div>
          ) : doctors.isPending ? (
            <div className={s.doctorGrid} aria-label="Loading doctor profiles">
              {[1, 2, 3].map((n) => (
                <div className={s.doctorSkeleton} key={n} />
              ))}
            </div>
          ) : filtered.length ? (
            <div className={s.doctorGrid}>
              {visibleDoctors.map((d) => {
                const memberships = d.memberships.filter(
                    (m) => !clinicId || m.clinicId === clinicId,
                  ),
                  fees = memberships.map((m) => m.feeMinor);
                return (
                  <article className={s.doctorCard} key={d.userId}>
                    <div className={s.doctorTop}>
                      <Avatar name={d.user.fullName} color={d.color} />
                      <span className={s.profileLabel}>
                        <Stethoscope size={15} />
                        {d.specialties[0]}
                      </span>
                    </div>
                    <h3>{d.user.fullName}</h3>
                    <p className={s.doctorBio}>{d.bio}</p>
                    <div className={s.doctorInfo}>
                      <span>
                        <Languages size={16} />
                        {d.languages.join(' · ')}
                      </span>
                      <span>
                        <MapPin size={16} />
                        {memberships.map((m) => m.clinic.name).join(' · ')}
                      </span>
                    </div>
                    <div className={s.doctorBottom}>
                      <div>
                        <span>Consultation from</span>
                        <strong>{fees.length ? money(Math.min(...fees)) : 'See profile'}</strong>
                      </div>
                      <Link
                        href={`/doctors?doctor=${encodeURIComponent(d.userId)}`}
                        className={s.profileButton}
                        aria-label={`View appointments with ${d.user.fullName}`}
                      >
                        <ArrowUpRight size={23} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={s.directoryState}>
              <Stethoscope size={30} />
              <h3>A different combination might help.</h3>
              <p>Try another specialty or view doctors across all locations.</p>
              <button
                className={s.textLink}
                onClick={() => {
                  setSpecialty('');
                  setClinicId('');
                  setResultPage(1);
                }}
              >
                See all doctors <ArrowRight size={17} />
              </button>
            </div>
          )}
          {!doctors.isPending && !doctors.error && filtered.length > 0 && (
            <div className={s.pagination}>
              <p aria-live="polite">
                Showing {firstResult + 1}-{Math.min(firstResult + pageSize, filtered.length)} of{' '}
                {filtered.length} doctor{filtered.length === 1 ? '' : 's'}
              </p>
              {pageCount > 1 && (
                <nav aria-label="Doctor result pages">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => changePage(currentPage - 1)}
                    aria-label="Previous doctor results page"
                  >
                    <ArrowLeft size={16} />
                    <span>Previous</span>
                  </button>
                  {pageNumbers.map((page) => (
                    <button
                      key={page}
                      aria-label={`Doctor results page ${page}`}
                      aria-current={page === currentPage ? 'page' : undefined}
                      onClick={() => changePage(page)}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === pageCount}
                    onClick={() => changePage(currentPage + 1)}
                    aria-label="Next doctor results page"
                  >
                    <span>Next</span>
                    <ArrowRight size={16} />
                  </button>
                </nav>
              )}
            </div>
          )}
          <p className={s.directoryFoot}>
            <ShieldCheck size={16} />
            Explore doctor profiles and fees before you sign in. An account is needed to book.
          </p>
        </section>
        <section className={`${s.principles} ${s.container}`} aria-label="Careflow at a glance">
          <div>
            <CalendarCheck2 />
            <span>
              Appointments that
              <br />
              <strong>fit your everyday</strong>
            </span>
          </div>
          <div>
            <Video />
            <span>
              In person or online.
              <br />
              <strong>Always a connection.</strong>
            </span>
          </div>
          <div>
            <FileHeart />
            <span>
              Your care history.
              <br />
              <strong>All in one place.</strong>
            </span>
          </div>
          <div>
            <ShieldCheck />
            <span>
              Personal information.
              <br />
              <strong>Your choice to share.</strong>
            </span>
          </div>
        </section>
        <section id="experience" className={s.experience}>
          <div className={s.container}>
            <div className={s.experienceHead} data-reveal>
              <p className={s.eyebrow}>A BETTER KIND OF TOGETHER</p>
              <h2>
                One visit is just the beginning.
                <br />
                <em>We’re here for the whole story.</em>
              </h2>
              <p>Less chasing details. More understanding your health.</p>
            </div>
            <div className={s.experienceGrid}>
              <div className={s.storyPanel}>
                <div className={s.tabs} role="tablist" aria-label="Your care journey">
                  {tabs.map((item, i) => (
                    <button
                      key={item.label}
                      role="tab"
                      id={`care-tab-${i}`}
                      aria-controls="care-story"
                      aria-selected={tab === i}
                      onClick={() => setTab(i)}
                      onKeyDown={(e) => {
                        if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
                          e.preventDefault();
                          const next =
                            e.key === 'Home'
                              ? 0
                              : e.key === 'End'
                                ? 2
                                : (tab + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                          setTab(next);
                          document.getElementById(`care-tab-${next}`)?.focus();
                        }
                      }}
                      tabIndex={tab === i ? 0 : -1}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div
                  role="tabpanel"
                  id="care-story"
                  aria-labelledby={`care-tab-${tab}`}
                  className={s.storyBody}
                >
                  <h3>{active.title}</h3>
                  <p>{active.body}</p>
                  <ul>
                    {active.items.map((item) => (
                      <li key={item}>
                        <Check size={17} />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" className={s.lightLink}>
                    Make care a little simpler <ArrowUpRight size={18} />
                  </Link>
                </div>
                <div className={s.careTimeline}>
                  <span className={s.overline}>YOUR CONNECTED CARE JOURNEY</span>
                  {active.steps.map((item, i) => (
                    <div key={item}>
                      <span>{i === 2 ? <Heart size={16} /> : <Check size={16} />}</span>
                      <strong>{item}</strong>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={s.storyAside}>
                <div className={s.teleCard}>
                  <Image
                    src="/images/consultation.jpg"
                    alt="A clinician using a phone with a stethoscope around their neck"
                    fill
                    sizes="(max-width: 760px) 92vw, 35vw"
                  />
                  <div />
                  <span className={s.teleIcon}>
                    <Video size={26} />
                  </span>
                  <div className={s.teleCopy}>
                    <span className={s.overline}>CLOSER, WHEREVER YOU ARE</span>
                    <h3>
                      A familiar face.
                      <br />
                      From your favourite place.
                    </h3>
                    <p>Private online consultations, with your doctor on the other side.</p>
                    <Link href="/doctors" className={s.lightLink}>
                      Explore online care <ArrowUpRight size={18} />
                    </Link>
                  </div>
                </div>
                <div className={s.recordCard}>
                  <FileHeart size={30} strokeWidth={1.5} />
                  <div>
                    <h3>Your story stays with you.</h3>
                    <p>
                      Notes, prescriptions, test results, and next steps. Connected to the visit
                      they belong to.
                    </p>
                  </div>
                  <ArrowUpRight size={24} />
                </div>
              </div>
            </div>
          </div>
        </section>
        <section id="how-it-works" className={`${s.section} ${s.container}`}>
          <div className={s.sectionHead} data-reveal>
            <div>
              <p className={s.eyebrow}>FROM “I SHOULD” TO “IT’S BOOKED”</p>
              <h2>
                Feeling better starts
                <br />
                <em>with a simple next step.</em>
              </h2>
            </div>
            <a href="#specialists" className={s.textLink}>
              Let’s find your doctor <ArrowUpRight size={19} />
            </a>
          </div>
          <div className={s.journey}>
            {journey.map(({ title, body, icon: Icon }, i) => (
              <article key={title}>
                <div className={s.stepTop}>
                  <span>0{i + 1}</span>
                  <Icon size={25} strokeWidth={1.5} />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={`${s.clinicSection} ${s.container}`}>
          <div className={s.clinicIntro}>
            <p className={s.eyebrow}>A PLACE THAT FITS YOUR LIFE</p>
            <h2>
              Good care.
              <br />
              <em>A little closer.</em>
            </h2>
            <p>
              Choose where you feel comfortable. Your care history stays together, wherever your
              next visit takes you.
            </p>
            <div className={s.locationNote}>
              <MapPin size={18} />
              Explore our clinic locations
            </div>
          </div>
          <div className={s.clinicList}>
            {clinics.isPending ? (
              <p>Loading clinic locations…</p>
            ) : clinics.error ? (
              <div>
                <p>Clinic locations are temporarily unavailable.</p>
                <button className={s.textLink} onClick={() => void clinics.refetch()}>
                  Try again <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              clinics.data?.map((c, i) => (
                <article className={s.clinicCard} key={c.id}>
                  <div className={s.clinicNumber}>
                    0{i + 1}
                    <Building2 size={26} strokeWidth={1.4} />
                  </div>
                  <div>
                    <h3>{c.name}</h3>
                    <p>
                      <MapPin size={15} />
                      {c.address}
                    </p>
                    <span>{c._count?.doctors ?? 0} doctors · In-person & online appointments</span>
                  </div>
                  <button
                    aria-label={`Explore doctors at ${c.name}`}
                    onClick={() => discover('', c.id)}
                  >
                    <ArrowUpRight size={24} />
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
        <section className={`${s.privacy} ${s.container}`} data-reveal>
          <div className={s.privacyVisual}>
            <div className={s.lockCircle}>
              <LockKeyhole size={46} strokeWidth={1.2} />
            </div>
            <span className={s.privacyChip}>
              <Check size={16} />
              Your records, protected
            </span>
            <span className={s.privacyChip}>
              <Check size={16} />
              Your sharing, your choice
            </span>
          </div>
          <div>
            <p className={s.eyebrow}>PERSONAL SHOULD STAY PERSONAL</p>
            <h2>
              Your health story.
              <br />
              <em>Your say.</em>
            </h2>
            <p>
              Care works better with trust. Your records stay with you and your treating doctor. You
              decide when to share history across clinics, and you can change your mind.
            </p>
            <div className={s.privacyChecks}>
              <span>
                <ShieldCheck size={18} />
                Clinic-based access
              </span>
              <span>
                <Clock3 size={18} />
                Time-limited sharing
              </span>
              <span>
                <ClipboardCheck size={18} />
                Consent you control
              </span>
            </div>
          </div>
        </section>
        <section id="questions" className={`${s.faqSection} ${s.container}`}>
          <div data-reveal>
            <p className={s.eyebrow}>A LITTLE CLARITY GOES A LONG WAY</p>
            <h2>
              Good questions.
              <br />
              <em>Thoughtful answers.</em>
            </h2>
            <p>A few things you might be wondering before you take the next step.</p>
            <Link href="/register" className={s.textLink}>
              Ready when you are <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className={s.faqList}>
            {faqs.map(([question, answer], i) => (
              <details key={question} name="careflow-faq" open={i === 0}>
                <summary>
                  {question}
                  <Plus size={20} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={`${s.finalCta} ${s.container}`} data-reveal>
          <span className={s.ctaHeart}>
            <HeartPulse size={145} strokeWidth={0.7} />
          </span>
          <p className={s.eyebrow}>MAKE A LITTLE TIME FOR YOU</p>
          <h2>
            A healthier everyday
            <br />
            starts with <em>one step.</em>
          </h2>
          <p>Your next conversation. Your next chapter. Your care, connected.</p>
          <div>
            <Link href="/register" className={s.creamButton}>
              Create your account <ArrowUpRight size={19} />
            </Link>
            <a href="#specialists" className={s.lightLink}>
              Find your doctor <ArrowRight size={18} />
            </a>
          </div>
        </section>
      </main>
      <footer className={`${s.footer} ${s.container}`}>
        <div className={s.footerMain}>
          <div>
            <Link href="/" className="brand">
              <span className="brand-mark">
                <HeartPulse />
              </span>
              careflow<span className={s.brandDot}>.</span>
            </Link>
            <p>
              A little care, all in one place.
              <br />
              Thoughtfully connected in Bangladesh.
            </p>
          </div>
          <div>
            <span>YOUR NEXT STEP</span>
            <a href="#specialists">Find your care</a>
            <Link href="/register">Create an account</Link>
            <Link href="/login">Your workspace</Link>
          </div>
          <div>
            <span>GET TO KNOW US</span>
            <a href="#experience">The Careflow way</a>
            <a href="#how-it-works">How it works</a>
            <a href="#questions">Questions & answers</a>
          </div>
          <div className={s.footerNote}>
            <ShieldCheck size={25} />
            <strong>A thoughtful demonstration.</strong>
            <p>Explore Careflow with illustrative profiles and synthetic care records.</p>
          </div>
        </div>
        <div className={s.footerBottom}>
          <span>© {new Date().getFullYear()} Careflow. Made with care.</span>
          <span>
            Illustrative photography via{' '}
            <a href="https://unsplash.com" target="_blank" rel="noreferrer">
              Unsplash <ArrowUpRight size={14} />
            </a>
          </span>
          <a href="#main">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}
