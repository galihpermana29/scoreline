import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { sendMail } from "./brevo";

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_SECONDS = 10 * 60;

/** A uniformly random 6-digit code from the platform CSPRNG. */
const sixDigitCode = (): string => {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const word = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(word);
    if (word[0]! < limit) return String(word[0]! % 1_000_000).padStart(6, "0");
  }
};

/** One email provider for login and signup alike: the first success creates the account. */
const emailCode = Email({
  id: "email-code",
  maxAge: CODE_TTL_SECONDS,
  normalizeIdentifier: (email) => email.trim().toLowerCase(),
  generateVerificationToken: async () => sixDigitCode(),
  sendVerificationRequest: async ({ identifier, token }) => {
    const outcome = await sendMail({
      to: identifier,
      subject: `${token} is your Scoreline code`,
      text: `Your Scoreline sign-in code is ${token}.\nIt expires in 10 minutes. If you did not ask for it, ignore this mail.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <p style="margin:0 0 12px;font-size:15px">Your Scoreline sign-in code:</p>
  <p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:6px">${token}</p>
  <p style="margin:0;font-size:13px;color:#666">It expires in 10 minutes. If you did not ask for it, ignore this mail.</p>
</div>`,
    });
    // A code that was never mailed must fail the sign-in step, not wait silently on a mail that is not coming.
    if (outcome.kind !== "sent") throw new Error("Could not send the sign-in code. Try again in a moment.");
  },
});

/** A TV signs in with the code a phone approved: the secret, the approval, the expiry and single use are all checked in `consume`. */
const pairing = ConvexCredentials({
  id: "pairing",
  authorize: async (credentials, ctx) => {
    const { code, secret } = credentials;
    if (typeof code !== "string" || typeof secret !== "string") return null;
    const userId = await ctx.runMutation(internal.pairing.consume, { code, secret });
    return userId === null ? null : { userId };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailCode, pairing],
  // 14 days idle ends a session and every visit extends it; 90 days ends any
  // session regardless, so a lost or shared device does not stay signed in forever.
  session: { inactiveDurationMs: 14 * DAY_MS, totalDurationMs: 90 * DAY_MS },
});
