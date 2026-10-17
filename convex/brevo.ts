/**
 * The one place that talks to Brevo. The outcome keeps the two failure kinds
 * apart on purpose (docs/match-alerts.md, "Never twice"): `rejected` means
 * Brevo answered with an error, so it definitely did not send; `unknown`
 * means no answer, so the mail may have gone out and must never be retried.
 */

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const SEND_TIMEOUT_MS = 15_000;

export type MailOutcome =
  | { kind: "sent" }
  | { kind: "rejected"; status: number; body: string }
  | { kind: "unknown"; error: string };

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

const SENDER_NAME = "Scoreline";

export const sendMail = async (mail: Mail): Promise<MailOutcome> => {
  const from = process.env.MAIL_FROM;
  if (!from) return { kind: "rejected", status: 0, body: "MAIL_FROM is not set." };

  // Dev deployments only: print the mail instead of sending it, so the
  // sign-in code can be read from the Convex logs without a Brevo key.
  if (process.env.MAIL_DRY_RUN === "1") {
    console.log(`[mail dry run] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return { kind: "sent" };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { kind: "rejected", status: 0, body: "BREVO_API_KEY is not set." };

  try {
    const response = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: from },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        ...(mail.headers ? { headers: mail.headers } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.ok) return { kind: "sent" };
    return { kind: "rejected", status: response.status, body: (await response.text()).slice(0, 500) };
  } catch (error) {
    return { kind: "unknown", error: error instanceof Error ? error.message : String(error) };
  }
};
