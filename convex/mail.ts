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

/** "Live now: A", "Live now: A, B", or "Live now: A and 2 more" - the subject for one mail covering several matches. */
const subjectFor = (titles: readonly string[]): string => {
  if (titles.length <= 2) return `Live now: ${titles.join(", ")}`;
  return `Live now: ${titles[0]} and ${titles.length - 1} more`;
};

/**
 * One mail per viewer per tick: every match that started streaming in the
 * same moment lands in the same message, each with its own Watch now button.
 */
export const alertMail = (input: {
  rows: readonly AlertRow[];
  to: string;
  appOrigin: string;
  unsubscribeLink: string;
}): Mail => {
  const { rows, to, appOrigin, unsubscribeLink } = input;
  const origin = appOrigin.replace(/\/$/, "");
  const manageUrl = `${origin}/?alerts=1`;

  const entries = rows.map((row) => {
    const path = watchPathFor(row);
    return {
      title: alertTitle(row),
      details: [row.competition?.name ?? null, kickoffLabel(row.kickoffMs)].filter((entry): entry is string => entry !== null),
      watchUrl: path === null ? null : `${origin}${path}`,
    };
  });

  const text = [
    ...entries.flatMap((entry, index) => [
      ...(index > 0 ? [""] : []),
      `Live now: ${entry.title}`,
      ...entry.details,
      ...(entry.watchUrl === null ? [] : [`Watch now: ${entry.watchUrl}`]),
    ]),
    "",
    `Manage alerts: ${manageUrl}`,
    `Turn off all alerts: ${unsubscribeLink}`,
  ].join("\n");

  const blocks = entries
    .map((entry, index) => {
      const button =
        entry.watchUrl === null
          ? ""
          : `<p style="margin:16px 0 0"><a href="${escapeHtml(entry.watchUrl)}" style="display:inline-block;background:#0a84ff;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:12px">Watch now</a></p>`;
      return `<div style="${index > 0 ? "margin-top:24px;padding-top:24px;border-top:1px solid #e5e5ea" : ""}">
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#d1242f">Live now</p>
  <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25">${escapeHtml(entry.title)}</h1>
  ${entry.details.map((line) => `<p style="margin:0 0 2px;font-size:15px;color:#555">${escapeHtml(line)}</p>`).join("\n  ")}
  ${button}
</div>`;
    })
    .join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#111">
${blocks}
  <p style="margin:28px 0 0;font-size:12px;color:#888"><a href="${escapeHtml(manageUrl)}" style="color:#888">Manage alerts</a> &middot; <a href="${escapeHtml(unsubscribeLink)}" style="color:#888">Turn off all alerts</a></p>
</div>`;

  return {
    to,
    subject: subjectFor(entries.map((entry) => entry.title)),
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
