import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";

type Pairing = { code: string; secret: string; expiresAt: number };

/** Square modules of a QR code as one SVG path, so it scales crisp and costs a single node. */
const qrPath = (text: string): { path: string; size: number } => {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { path, size };
};

/**
 * The TV half of QR pairing. It asks Convex for a pairing (a short code and
 * a secret only this browser holds), shows the code as a QR for the phone
 * and as text beside it, and holds a live query on the pairing: the moment
 * the phone approves, it signs in through the pairing credentials provider.
 * A pairing is good for 5 minutes and used once; an expired one is replaced
 * here on its own.
 */
export default function PairingPanel() {
  const { signIn } = useAuthActions();
  const create = useMutation(api.pairing.create);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [failed, setFailed] = useState(false);

  const renew = useCallback(async () => {
    try {
      setFailed(false);
      setPairing(await create());
    } catch {
      setFailed(true);
    }
  }, [create]);

  useEffect(() => {
    void renew();
  }, [renew]);

  // Replace the pairing when its time is up, without waiting for a query to notice.
  useEffect(() => {
    if (pairing === null) return;
    const timer = window.setTimeout(() => void renew(), Math.max(0, pairing.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pairing, renew]);

  const status = useQuery(api.pairing.watch, pairing === null ? "skip" : { code: pairing.code, secret: pairing.secret });

  useEffect(() => {
    if (pairing === null) return;
    if (status === "approved") void signIn("pairing", { code: pairing.code, secret: pairing.secret }).catch(() => void renew());
    else if (status === "gone") void renew();
  }, [status, pairing, signIn, renew]);

  const url = pairing === null ? null : `${window.location.origin}/link?code=${pairing.code}`;
  const qr = useMemo(() => (url === null ? null : qrPath(url)), [url]);

  return (
    <div className="pair">
      <h3>Sign in with your phone</h3>
      <p className="gate-lede">Scan this with your phone, then approve the code.</p>
      {qr === null ? (
        <div className="pair-skeleton" aria-hidden />
      ) : (
        <svg className="pair-qr" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label="QR code to sign in on this screen" shapeRendering="crispEdges">
          <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
      )}
      <div className="pair-code" aria-live="polite">
        {failed ? "Could not reach the server" : (pairing?.code ?? "...")}
      </div>
      {failed ? (
        <button className="button-tinted" type="button" onClick={() => void renew()}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
