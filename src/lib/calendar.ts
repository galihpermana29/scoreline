import { matchLabel, type Match } from "../domain/match";

const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const icsText = (value: string) => value.replace(/[\\,;]/g, (char) => `\\${char}`).replace(/\n/g, "\\n");

/** Downloads a two-hour calendar event for the match's kick-off. */
export const downloadCalendarEvent = (match: Match) => {
  if (!match.kickoff) return;
  const end = new Date(match.kickoff.getTime() + 2 * 60 * 60 * 1000);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scoreline//EN",
    "BEGIN:VEVENT",
    `UID:${match.id}@scoreline.local`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(match.kickoff)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(matchLabel(match))}`,
    `DESCRIPTION:${icsText(match.league.name)}`,
    match.venue ? `LOCATION:${icsText(match.venue)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: `${match.home.name}-vs-${match.away.name}.ics`,
  });
  link.click();
  URL.revokeObjectURL(url);
};
