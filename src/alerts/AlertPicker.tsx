import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ALERT_SPORTS, CLUBS, type AlertSport } from "../../shared/alerts";
import { Icon } from "../components/icons";
import { useMediaQuery } from "../lib/useMediaQuery";

const PHONE_QUERY = "(max-width: 739px)";

type Choices = { clubs: string[]; sports: AlertSport[] };

const Switch = ({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) => (
  <button type="button" className="alert-row" role="switch" aria-checked={on} onClick={onToggle}>
    <span className="alert-row-text">
      <span className="alert-row-label">{label}</span>
      {hint ? <span className="alert-row-hint">{hint}</span> : null}
    </span>
    <span className={`switch${on ? " is-on" : ""}`} aria-hidden>
      <span className="switch-knob" />
    </span>
  </button>
);

const toggled = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);

/**
 * The alerts picker: clubs (the football choice), badminton, and the two
 * motorsport series, every row a toggle. `first` is the one-time prompt after
 * an account's first sign-in (Skip or Save, no way to just dismiss it);
 * `manage` is the bell. A sheet on phones, a dialog on wider screens, on a
 * black scrim - transform and opacity only.
 */
export default function AlertPicker({
  mode,
  initial,
  onClose,
}: {
  mode: "first" | "manage";
  initial: Choices;
  onClose: () => void;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const save = useMutation(api.alerts.save);
  const skip = useMutation(api.alerts.skip);
  const [choices, setChoices] = useState<Choices>({ clubs: initial.clubs, sports: initial.sports });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    choices.clubs.length !== initial.clubs.length ||
    choices.sports.length !== initial.sports.length ||
    choices.clubs.some((club) => !initial.clubs.includes(club)) ||
    choices.sports.some((sport) => !initial.sports.includes(sport));

  useEffect(() => {
    if (mode === "first") return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => run(() => save(choices));
  const onSkip = () => run(() => skip());

  return (
    <>
      <motion.div
        className="alerts-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={mode === "manage" ? onClose : undefined}
      />
      <motion.div
        className={`alerts${phone ? " is-sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alerts-title"
        initial={phone ? { y: "100%" } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={phone ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
        exit={phone ? { y: "100%" } : { opacity: 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
      >
        <header className="alerts-head">
          <div>
            <h2 id="alerts-title">{mode === "first" ? "Get alerts for your teams" : "Match alerts"}</h2>
            <p>We email you a link when one of these starts streaming.</p>
          </div>
          {mode === "manage" ? (
            <button className="close-button" onClick={onClose} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </header>

        <div className="alerts-body">
          <section>
            <h3>Clubs</h3>
            <div className="alert-group">
              {CLUBS.map((club) => (
                <Switch
                  key={club.id}
                  label={club.name}
                  on={choices.clubs.includes(club.id)}
                  onToggle={() => setChoices((current) => ({ ...current, clubs: toggled(current.clubs, club.id) }))}
                />
              ))}
            </div>
          </section>
          <section>
            <h3>Badminton</h3>
            <div className="alert-group">
              {ALERT_SPORTS.filter((sport) => sport.id === "badminton").map((sport) => (
                <Switch
                  key={sport.id}
                  label={sport.name}
                  hint={sport.hint}
                  on={choices.sports.includes(sport.id)}
                  onToggle={() => setChoices((current) => ({ ...current, sports: toggled(current.sports, sport.id) }))}
                />
              ))}
            </div>
          </section>
          <section>
            <h3>Motorsport</h3>
            <div className="alert-group">
              {ALERT_SPORTS.filter((sport) => sport.id !== "badminton").map((sport) => (
                <Switch
                  key={sport.id}
                  label={sport.name}
                  hint={sport.hint}
                  on={choices.sports.includes(sport.id)}
                  onToggle={() => setChoices((current) => ({ ...current, sports: toggled(current.sports, sport.id) }))}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="alerts-foot">
          {error ? (
            <p className="gate-error" role="alert">
              {error}
            </p>
          ) : null}
          {mode === "first" ? (
            <button className="button-tinted" onClick={() => void onSkip()} disabled={busy}>
              Skip
            </button>
          ) : null}
          <button className="button-primary" onClick={() => void onSave()} disabled={busy || (mode === "manage" && !dirty)}>
            {busy ? "Saving..." : "Save"}
          </button>
        </footer>
      </motion.div>
    </>
  );
}
