import { useAuthActions } from "@convex-dev/auth/react";
import { motion } from "motion/react";
import { lazy, Suspense, useRef, useState, type FormEvent } from "react";
import { ScorelineBadge } from "../components/Logo";
import { useMediaQuery } from "../lib/useMediaQuery";

// The QR encoder and the pairing UI are their own chunk: a phone never loads
// them, and a wide screen only pays for them when the modal opens.
const PairingPanel = lazy(() => import("./PairingPanel"));

const PHONE_QUERY = "(max-width: 739px)";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = { kind: "email" } | { kind: "code"; email: string };

const messageOf = (error: unknown, fallback: string): string => {
  const text = error instanceof Error ? error.message : "";
  // Convex wraps server errors in a request-id header; keep only the sentence a person can act on.
  const line = text.split("\n").find((entry) => /could not|invalid|expired|try again/i.test(entry));
  return line?.replace(/^.*?Error:\s*/, "").trim() || fallback;
};

/**
 * One modal for login and signup: the first success creates the account,
 * every later one opens it. Wide screens, TV included, also get the QR
 * pairing column; a phone cannot scan its own screen, so it gets the form only.
 */
export default function SignInModal({ leaveLabel, onLeave }: { leaveLabel: string; onLeave: () => void }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [step, setStep] = useState<Step>({ kind: "email" });

  return (
    <motion.div
      className="gate-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
    >
      <div className="gate-form-side">
        <span className="gate-mark" aria-hidden>
          <ScorelineBadge />
        </span>
        {step.kind === "email" ? (
          <EmailStep onSent={(email) => setStep({ kind: "code", email })} />
        ) : (
          <CodeStep email={step.email} onBack={() => setStep({ kind: "email" })} />
        )}
        <button type="button" className="gate-leave" onClick={onLeave}>
          {leaveLabel}
        </button>
      </div>
      {phone ? null : (
        <div className="gate-pair-side">
          <Suspense fallback={<div className="pair-skeleton" aria-hidden />}>
            <PairingPanel />
          </Suspense>
        </div>
      )}
    </motion.div>
  );
}

const EmailStep = ({ onSent }: { onSent: (email: string) => void }) => {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(clean)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn("email-code", { email: clean });
      onSent(clean);
    } catch (caught) {
      setError(messageOf(caught, "Could not send the code. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gate-form" onSubmit={submit} noValidate>
      <h2 id="gate-title">Sign in to Scoreline</h2>
      <p className="gate-lede">Enter your email and we will send you a 6-digit code. New here? That creates your account.</p>
      <label className="gate-field">
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error !== null}
        />
      </label>
      {error ? (
        <p className="gate-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary gate-submit" type="submit" disabled={busy}>
        {busy ? "Sending..." : "Email me a code"}
      </button>
    </form>
  );
};

const CodeStep = ({ email, onBack }: { email: string; onBack: () => void }) => {
  const { signIn } = useAuthActions();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      // Success flips the auth state, which lifts the gate; nothing else to do here.
      await signIn("email-code", { email, code: value });
    } catch (caught) {
      setError(messageOf(caught, "That code did not work. Check it, or ask for a new one."));
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !busy) void verify(digits);
  };

  const resend = async () => {
    setError(null);
    try {
      await signIn("email-code", { email });
      setResent(true);
    } catch (caught) {
      setError(messageOf(caught, "Could not send a new code. Try again in a moment."));
    }
  };

  return (
    <form
      className="gate-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.length === 6 && !busy) void verify(code);
      }}
    >
      <h2 id="gate-title">Check your email</h2>
      <p className="gate-lede">
        We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
      </p>
      <label className="gate-field">
        <span>Code</span>
        <input
          ref={inputRef}
          className="gate-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error !== null}
        />
      </label>
      {error ? (
        <p className="gate-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary gate-submit" type="submit" disabled={busy || code.length !== 6}>
        {busy ? "Checking..." : "Sign in"}
      </button>
      <div className="gate-links">
        <button type="button" onClick={onBack}>
          Use a different email
        </button>
        <button type="button" onClick={() => void resend()} disabled={resent}>
          {resent ? "New code sent" : "Send a new code"}
        </button>
      </div>
    </form>
  );
};
