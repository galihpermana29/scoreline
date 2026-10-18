import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Icon } from "../components/icons";
import { openSignIn } from "../auth/signInUi";
import { navigate } from "../lib/router";

/**
 * The phone's half of QR pairing, opened from the TV's QR code. A guest
 * can open the page. Approve needs the phone's account, so a signed-out
 * visitor is asked to sign in, then taps Approve. The code
 * shown here and on the TV is what stops someone from tricking a viewer
 * into approving a stranger's device.
 */
export const LinkScreen = ({ code }: { code: string }) => {
  const { isAuthenticated } = useConvexAuth();
  const clean = code.trim().toUpperCase();
  const waiting = useQuery(api.pairing.peek, clean === "" ? "skip" : { code: clean });
  const approve = useMutation(api.pairing.approve);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const onApprove = async () => {
    if (!isAuthenticated) {
      openSignIn();
      return;
    }
    setState("busy");
    try {
      await approve({ code: clean });
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="screen link-screen">
      <div className="link-card">
        {state === "done" ? (
          <>
            <span className="link-done" aria-hidden>
              <Icon name="check" size={26} />
            </span>
            <h1>Your TV is signing in</h1>
            <p>You can close this page.</p>
          </>
        ) : clean === "" || waiting === false || state === "error" ? (
          <>
            <h1>This code has expired</h1>
            <p>Ask your TV for a new QR code and scan it again.</p>
            <button className="button-tinted" onClick={() => navigate("/", { replace: true })}>
              Go to Scoreline
            </button>
          </>
        ) : (
          <>
            <h1>Sign in on your TV?</h1>
            <p>Only approve if this code is showing on your TV right now.</p>
            <div className="pair-code link-code">{clean}</div>
            <button className="button-primary" onClick={() => void onApprove()} disabled={state === "busy" || waiting === undefined}>
              {state === "busy" ? "Approving..." : isAuthenticated ? "Approve" : "Sign in to approve"}
            </button>
            <button className="button-tinted" onClick={() => navigate("/", { replace: true })}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
};
