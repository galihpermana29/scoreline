import { alertTitle, type AlertRow } from "../shared/alerts";
import { matchPath } from "../shared/route";
import type { Mail } from "./brevo";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const kickoffLabel = (kickoffMs: number | null): string | null =>
  kickoffMs === null ? null : `${wib.format(new Date(kickoffMs))} WIB`;

/** The app's own watch path for the mail's button, or null when the row lacks its SEO slugs (then the mail has no button). */
export const watchPathFor = (row: AlertRow): string | null =>
  row.slugs === null ? null : matchPath(row.sportId, row.slugs, row.matchId);

/** Convex serves HTTP actions on the deployment's site URL, not on the app's origin, so the unsubscribe link points there. */
export const unsubscribeUrl = (siteUrl: string, userId: string, signature: string): string =>
  `${siteUrl.replace(/\/$/, "")}/unsubscribe?u=${encodeURIComponent(userId)}&s=${signature}`;

export const alertMail = (input: {
  row: AlertRow;
  to: string;
  appOrigin: string;
  unsubscribeLink: string;
}): Mail => {
  const { row, to, appOrigin, unsubscribeLink } = input;
  const origin = appOrigin.replace(/\/$/, "");
  const title = alertTitle(row);
  const competition = row.competition?.name ?? null;
  const kickoff = kickoffLabel(row.kickoffMs);
  const path = watchPathFor(row);
  const watchUrl = path === null ? null : `${origin}${path}`;
  const manageUrl = `${origin}/?alerts=1`;

  const details = [competition, kickoff].filter((entry): entry is string => entry !== null);
  const text = [
    `Live now: ${title}`,
    ...details,
    ...(watchUrl === null ? [] : ["", `Watch now: ${watchUrl}`]),
    "",
    `Manage alerts: ${manageUrl}`,
    `Turn off all alerts: ${unsubscribeLink}`,
  ].join("\n");

  const button =
    watchUrl === null
      ? ""
      : `<p style="margin:24px 0"><a href="${escapeHtml(watchUrl)}" style="display:inline-block;background:#0a84ff;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:12px">Watch now</a></p>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#111">
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#d1242f">Live now</p>
  <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
  ${details.map((line) => `<p style="margin:0 0 2px;font-size:15px;color:#555">${escapeHtml(line)}</p>`).join("\n  ")}
  ${button}
  <p style="margin:28px 0 0;font-size:12px;color:#888"><a href="${escapeHtml(manageUrl)}" style="color:#888">Manage alerts</a> &middot; <a href="${escapeHtml(unsubscribeLink)}" style="color:#888">Turn off all alerts</a></p>
</div>`;

  return {
    to,
    subject: `Live now: ${title}`,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
};

export const operatorMail = (to: string, subject: string, lines: readonly string[]): Mail => ({
  to,
  subject,
  text: lines.join("\n"),
  html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;padding:16px;color:#111">${lines
    .map((line) => `<p style="margin:0 0 8px;font-size:14px">${escapeHtml(line)}</p>`)
    .join("")}</div>`,
});
