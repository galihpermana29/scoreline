const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longDateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export const formatTime = (date: Date): string => timeFormat.format(date);
export const formatWeekday = (date: Date): string => weekdayFormat.format(date);
export const formatLongDate = (date: Date): string => longDateFormat.format(date);
export const formatShortDate = (date: Date): string => shortDateFormat.format(date);

export const startOfLocalDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const isSameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const relativeDayLabel = (date: Date, today = new Date()): string => {
  if (isSameLocalDay(date, today)) return "Today";
  if (isSameLocalDay(date, addDays(today, 1))) return "Tomorrow";
  if (isSameLocalDay(date, addDays(today, -1))) return "Yesterday";
  return formatLongDate(date);
};
