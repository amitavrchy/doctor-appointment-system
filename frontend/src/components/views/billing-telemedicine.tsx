'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Download,
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  ShieldCheck,
} from 'lucide-react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import { api, post, money, dateLabel, timeLabel } from '@/lib/api';
import type { Appointment, User } from '@/lib/types';
import { Badge, Empty, ErrorState, Loading, Modal, PageHeading } from '../ui';
import { useToast } from '../providers';
export function Billing({ user, clinicId }: { user: User; clinicId?: string }) {
  const toast = useToast(),
    client = useQueryClient();
  const [selected, setSelected] = useState<Appointment | null>(null),
    [busy, setBusy] = useState(false),
    [intent, setIntent] = useState<{
      provider: string;
      clientSecret?: string;
      paymentId: string;
    } | null>(null);
  const query = useQuery({
    queryKey: ['appointments', clinicId],
    queryFn: () => api<Appointment[]>(`/appointments${clinicId ? `?clinicId=${clinicId}` : ''}`),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const appointments = query.data.filter((a) => a.payment);
  const paid = appointments.reduce(
      (s, a) => s + (a.payment?.status === 'SUCCEEDED' ? a.payment.amountMinor : 0),
      0,
    ),
    due = appointments.reduce(
      (s, a) =>
        s +
        (a.payment &&
        ['CREATED', 'REQUIRES_ACTION'].includes(a.payment.status) &&
        !['CANCELLED', 'RESCHEDULED'].includes(a.status)
          ? a.payment.amountMinor
          : 0),
      0,
    ),
    refunds = appointments.reduce((s, a) => s + (a.payment?.refundMinor || 0), 0);
  async function pay(a: Appointment) {
    setBusy(true);
    try {
      if (a.payment?.provider === 'sslcommerz') {
        setSelected(a);
        setIntent({ provider: 'sslcommerz', paymentId: a.payment.id });
        return;
      }
      const result = await post<{
        provider: string;
        clientSecret?: string;
        paymentId: string;
        checkoutUrl?: string;
      }>('/payments/intent', { appointmentId: a.id });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setSelected(a);
      setIntent(result);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Payments & invoices"
        description="A clear view of your care, down to the details."
      />
      <div className="stats stats-three">
        {[
          ['Paid', paid],
          ['Amount due', due],
          ['Refunds issued / pending', refunds],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-top">
              {label}
              <CreditCard size={18} />
            </div>
            <div className="stat-value">{money(Number(value))}</div>
            <p className="small">Consultation fees · BDT</p>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Your invoices</h2>
          <span className="small">{appointments.length} invoices</span>
        </div>
        {appointments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultation</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Payment status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id} data-testid={`invoice-${a.id}`}>
                    <td>
                      <strong>{a.doctor.user.fullName}</strong>
                      <small>
                        {a.patient.fullName} · {a.clinic.name}
                      </small>
                    </td>
                    <td>{dateLabel(a.startAt)}</td>
                    <td>
                      <strong>{money(a.feeMinor)}</strong>
                      {!!a.payment?.refundMinor && (
                        <small>Refund: {money(a.payment.refundMinor)}</small>
                      )}
                    </td>
                    <td>
                      <Badge status={a.payment!.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {['CREATED', 'REQUIRES_ACTION'].includes(a.payment!.status) &&
                          !['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(a.status) && (
                            <button
                              className="button primary small"
                              disabled={busy}
                              onClick={() => pay(a)}
                            >
                              Pay now
                            </button>
                          )}
                        <a
                          className="icon-button"
                          aria-label={`Download invoice for ${a.doctor.user.fullName}`}
                          href={`/api/payments/${a.id}/invoice`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download size={18} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="All clear here"
            body="Your consultation invoices will appear after booking."
          />
        )}
      </section>
      {selected && intent && (
        <Modal
          title="Complete your payment"
          onClose={() => {
            setSelected(null);
            setIntent(null);
          }}
        >
          <div className="booking-summary">
            <h3>{selected.doctor.user.fullName}</h3>
            <p className="small">
              {dateLabel(selected.startAt)} · {selected.clinic.name}
            </p>
            <h2 style={{ marginTop: 20 }}>{money(selected.feeMinor)}</h2>
          </div>
          {intent.provider === 'demo' ? (
            <>
              <div className="warning-box" style={{ marginTop: 20 }}>
                Demo payment. No money is collected. Use this to explore the full booking and
                invoice flow.
              </div>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await post(`/payments/${intent.paymentId}/demo-settle`);
                      await client.invalidateQueries({ queryKey: ['appointments'] });
                      toast('Demo payment completed. Your invoice is ready.');
                      setSelected(null);
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Processing…' : 'Complete demo payment'}
                </button>
              </div>
            </>
          ) : intent.provider === 'sslcommerz' ? (
            <HostedCheckout appointmentId={selected.id} />
          ) : (
            <StripeCheckout
              clientSecret={intent.clientSecret!}
              onPaid={() => {
                void client.invalidateQueries({ queryKey: ['appointments'] });
                setSelected(null);
                toast('Payment submitted. Status updates after provider verification.');
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
function HostedCheckout({ appointmentId }: { appointmentId: string }) {
  const [phone, setPhone] = useState(''),
    [address, setAddress] = useState(''),
    [city, setCity] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="form-stack"
      style={{ marginTop: 20 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await post<{ checkoutUrl: string }>('/payments/intent', {
            appointmentId,
            billing: { phone, address, city },
          });
          window.location.assign(result.checkoutUrl);
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="info-box">
        SSLCommerz requires billing contact details. You will continue to its secure hosted checkout
        to select a payment method.
      </div>
      <label>
        Billing phone
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          minLength={7}
          maxLength={20}
          autoComplete="tel"
          required
        />
      </label>
      <label>
        Billing address
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          minLength={3}
          maxLength={250}
          autoComplete="street-address"
          required
        />
      </label>
      <label>
        Billing city
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          minLength={2}
          maxLength={100}
          autoComplete="address-level2"
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="button primary" disabled={busy}>
        {busy ? 'Opening secure checkout...' : 'Continue to SSLCommerz'}
      </button>
    </form>
  );
}
function StripeCheckout({ clientSecret, onPaid }: { clientSecret: string; onPaid: () => void }) {
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<null | {
    confirmPayment: (options: unknown) => Promise<{ error?: { message: string } }>;
  }>(null);
  const elementsRef = useRef<unknown>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => {
      if (!active) return;
      const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!key) {
        setError('Stripe publishable key is not configured');
        return;
      }
      const stripe = (
        window as unknown as {
          Stripe: (key: string) => {
            elements: (options: unknown) => {
              create: (type: string) => { mount: (node: HTMLElement) => void };
            };
            confirmPayment: (options: unknown) => Promise<{ error?: { message: string } }>;
          };
        }
      ).Stripe(key);
      const elements = stripe.elements({ clientSecret });
      if (container.current) elements.create('payment').mount(container.current);
      stripeRef.current = stripe;
      elementsRef.current = elements;
      setReady(true);
    };
    script.onerror = () => setError('Unable to load secure payment form');
    document.body.appendChild(script);
    return () => {
      active = false;
      script.remove();
    };
  }, [clientSecret]);
  return (
    <div style={{ marginTop: 20 }}>
      <div ref={container} />
      {error && <p className="form-error">{error}</p>}
      <button
        className="button primary full"
        style={{ marginTop: 20 }}
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          const result = await stripeRef.current?.confirmPayment({
            elements: elementsRef.current,
            confirmParams: { return_url: `${window.location.origin}/billing` },
            redirect: 'if_required',
          });
          setBusy(false);
          if (result?.error) setError(result.error.message);
          else onPaid();
        }}
      >
        Pay securely with Stripe
      </button>
    </div>
  );
}
export function Telemedicine({ user, clinicId }: { user: User; clinicId?: string }) {
  const [selected, setSelected] = useState<Appointment | null>(null);
  const query = useQuery({
    queryKey: ['appointments', clinicId],
    queryFn: () => api<Appointment[]>(`/appointments${clinicId ? `?clinicId=${clinicId}` : ''}`),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const appointments = query.data.filter(
    (a) =>
      a.type === 'TELEMEDICINE' &&
      ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status) &&
      (a.patientId === user.id || a.doctorId === user.id),
  );
  return (
    <>
      <PageHeading
        eyebrow="Care, wherever you are"
        title="A familiar face. A little closer."
        description="Your private consultation room opens 15 minutes before your visit."
      />
      <div className="info-box" style={{ marginBottom: 24 }}>
        <ShieldCheck size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />
        Only you and your doctor can enter your room. Your doctor will admit you when they’re ready.
      </div>
      {appointments.length ? (
        <div className="doctor-grid">
          {appointments.map((a) => (
            <article className="doctor-card" key={a.id}>
              <span className="stat-icon">
                <Video size={23} />
              </span>
              <h3 style={{ marginTop: 17 }}>{a.doctor.user.fullName}</h3>
              <p>{a.patient.fullName}</p>
              <p className="detail-line">
                {dateLabel(a.startAt)} · {timeLabel(a.startAt)}
              </p>
              <Badge status={a.teleSession?.status || 'SCHEDULED'} />
              <button
                className="button primary full"
                style={{ marginTop: 20 }}
                onClick={() => setSelected(a)}
              >
                <Video size={17} />
                Open waiting room
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Care from the comfort of home"
            body="Book a telemedicine appointment to meet your doctor here."
            action={{ href: '/doctors', label: 'Find a doctor' }}
          />
        </div>
      )}
      {selected && (
        <RoomModal appointment={selected} user={user} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
function ConsultationChat({
  appointmentId,
  userId,
  enabled,
}: {
  appointmentId: string;
  userId: string;
  enabled: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['tele-messages', appointmentId],
    queryFn: () =>
      api<{ id: string; authorId: string; text: string; createdAt: string }[]>(
        `/telemedicine/${appointmentId}/messages`,
      ),
    refetchInterval: 5000,
  });
  return (
    <section className="consultation-chat panel">
      <h3>Consultation chat</h3>
      <p className="small">
        Messages are saved with this visit and visible to you and your doctor.
      </p>
      {query.error ? (
        <p className="form-error">{query.error.message}</p>
      ) : (
        <div className="chat-history" aria-live="polite">
          {query.data?.length ? (
            query.data.map((m) => (
              <div className={`chat-message ${m.authorId === userId ? 'mine' : ''}`} key={m.id}>
                <strong>{m.authorId === userId ? 'You' : 'Your care partner'}</strong>
                <p>{m.text}</p>
                <time>
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            ))
          ) : (
            <p className="small">Your conversation starts here.</p>
          )}
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/telemedicine/${appointmentId}/messages`, { text });
            setText('');
            await query.refetch();
          } catch (error) {
            toast((error as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Message
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            disabled={!enabled}
            required
            placeholder={
              enabled ? 'Write to your care partner...' : 'Open the waiting room to chat'
            }
          />
        </label>
        <button className="button secondary" disabled={busy || !enabled || !text.trim()}>
          {busy ? 'Sending...' : 'Send message'}
        </button>
      </form>
    </section>
  );
}
function RoomModal({
  appointment,
  user,
  onClose,
}: {
  appointment: Appointment;
  user: User;
  onClose: () => void;
}) {
  const toast = useToast(),
    client = useQueryClient();
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [error, setError] = useState('');
  const room = useRef<Room | null>(null),
    videoContainer = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ['tele', appointment.id],
    queryFn: () => api<{ status: string; provider: string }>(`/telemedicine/${appointment.id}`),
    refetchInterval: 5000,
  });
  useEffect(
    () => () => {
      void room.current?.disconnect();
    },
    [],
  );
  async function join() {
    setBusy(true);
    setError('');
    try {
      const result = await post<{
        provider: string;
        token?: string;
        url?: string;
        status: string;
        message?: string;
      }>(`/telemedicine/${appointment.id}/token`, { recordingConsent: consent });
      if (result.provider === 'demo' || !result.token) {
        toast(result.message || 'Waiting for your doctor.');
        void query.refetch();
        return;
      }
      const r = new Room({ adaptiveStream: true, dynacast: true });
      room.current = r;
      r.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _p: RemoteTrackPublication, _u: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            const element = track.attach();
            videoContainer.current?.appendChild(element);
          }
        },
      );
      r.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
      r.on(RoomEvent.Disconnected, () => setConnected(false));
      await r.connect(result.url!, result.token);
      await r.localParticipant.enableCameraAndMicrophone();
      const local = r.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (local) {
        const element = local.attach();
        element.muted = true;
        videoContainer.current?.appendChild(element);
      }
      setConnected(true);
    } catch (e) {
      setError((e as Error).message);
      await room.current?.disconnect();
    } finally {
      setBusy(false);
    }
  }
  async function transition(status: string) {
    setBusy(true);
    try {
      await post(`/telemedicine/${appointment.id}/transition`, { status });
      await query.refetch();
      if (status === 'ENDED') await room.current?.disconnect();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Your consultation room"
      wide
      onClose={() => {
        void room.current?.disconnect();
        onClose();
      }}
    >
      <div className="video-room">
        <Video size={46} strokeWidth={1.3} />
        <h2>{connected ? 'You’re connected.' : 'A moment for your care.'}</h2>
        <p>
          {appointment.doctor.user.fullName} · {appointment.patient.fullName}
        </p>
        <Badge status={query.data?.status || 'SCHEDULED'} />
        {query.data?.provider === 'demo' && (
          <span className="demo-label">Demo room · live video requires LiveKit configuration</span>
        )}
        <div className="video-grid" ref={videoContainer} />
      </div>
      {!connected && (
        <label className="check" style={{ marginTop: 20 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I consent to recording if my doctor requests it. Recording is disabled in this version.
          </span>
        </label>
      )}
      {error && (
        <p className="form-error" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <div className="video-controls">
        {connected ? (
          <>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await room.current?.localParticipant.setMicrophoneEnabled(!mic);
                  setMic(!mic);
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              {mic ? <Mic size={18} /> : <MicOff size={18} />}Microphone
            </button>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await room.current?.localParticipant.setCameraEnabled(!camera);
                  setCamera(!camera);
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              {camera ? <Video size={18} /> : <VideoOff size={18} />}Camera
            </button>
            <button
              className="button danger"
              onClick={() => {
                void room.current?.disconnect();
                setConnected(false);
              }}
            >
              <PhoneOff size={18} />
              Leave
            </button>
          </>
        ) : (
          <button
            className="button primary"
            disabled={busy || ['ENDED', 'CANCELLED'].includes(query.data?.status || '')}
            onClick={join}
          >
            {busy ? 'Connecting…' : 'Join consultation'}
          </button>
        )}
        {user.id === appointment.doctorId && query.data?.status === 'SCHEDULED' && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => transition('WAITING')}
          >
            Open waiting room
          </button>
        )}
        {user.id === appointment.doctorId && query.data?.status === 'WAITING' && (
          <button className="button primary" disabled={busy} onClick={() => transition('LIVE')}>
            Admit patient
          </button>
        )}
        {user.id === appointment.doctorId && query.data?.status === 'LIVE' && (
          <button className="button danger" disabled={busy} onClick={() => transition('ENDED')}>
            End session
          </button>
        )}
      </div>
      <ConsultationChat
        appointmentId={appointment.id}
        userId={user.id}
        enabled={['WAITING', 'LIVE'].includes(query.data?.status || '')}
      />
    </Modal>
  );
}
