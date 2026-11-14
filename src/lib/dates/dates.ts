import { TIME_ZONE } from "@/lib/env/config";
import { t } from "@/lib/text/interpolate";
import { dates } from "@/strings/dates";

type CalendarDate = { year: number; month: number; day: number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function toCalendarDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function parse(value: string): CalendarDate {
  const date = toCalendarDate(value);
  if (!date) throw new RangeError(`Invalid community date: "${value}"`);
  return date;
}

function serialize({ year, month, day }: CalendarDate): string {
  const value = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  parse(value);
  return value;
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (Hinnant's days_from_civil).
function toDayNumber({ year, month, day }: CalendarDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function fromDayNumber(dayNumber: number): CalendarDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: era * 400 + yearOfEra + (month <= 2 ? 1 : 0), month, day };
}

export function isIsoDate(value: string): boolean {
  return toCalendarDate(value) !== null;
}

export function communityToday(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError(`Invalid instant: ${String(now)}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((p) => p.type === type)?.value);
  return serialize({
    year: part("year"),
    month: part("month"),
    day: part("day"),
  });
}

const DAY_MS = 86_400_000;

// How far the community's wall clock is ahead of UTC at an instant.
function zoneOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall =
    toDayNumber({
      year: part("year"),
      month: part("month"),
      day: part("day"),
    }) *
      DAY_MS +
    ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1000;
  return wall - instant;
}

// The instant `date` begins in the community time zone. The clocks change at
// 02:00/03:00 there, so midnight always exists; the second pass settles an
// offset read on the wrong side of a change.
export function communityMidnight(date: string): Date {
  const wallMidnight = toDayNumber(parse(date)) * DAY_MS;
  const guess = wallMidnight - zoneOffsetMs(wallMidnight);
  return new Date(wallMidnight - zoneOffsetMs(guess));
}

export function firstOfMonth(date: string): string {
  return serialize({ ...parse(date), day: 1 });
}

export function firstOfNextMonth(date: string): string {
  const { year, month } = parse(date);
  return month === 12
    ? serialize({ year: year + 1, month: 1, day: 1 })
    : serialize({ year, month: month + 1, day: 1 });
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Invalid day count: ${days}`);
  }
  return serialize(fromDayNumber(toDayNumber(parse(date)) + days));
}

export function daysBetween(from: string, to: string): number {
  return toDayNumber(parse(to)) - toDayNumber(parse(from));
}

export function loanLengthDays(start: string, end: string): number {
  const length = daysBetween(start, end) + 1;
  if (length < 1) {
    throw new RangeError(`End "${end}" is before start "${start}"`);
  }
  return length;
}

function nameParts(date: CalendarDate) {
  const weekdayIndex = (((toDayNumber(date) + 3) % 7) + 7) % 7;
  return {
    weekday: dates.weekdays[weekdayIndex],
    day: date.day,
    month: dates.months[date.month - 1],
  };
}

export function formatDate(date: string, today: string): string {
  const value = parse(date);
  const sameYear = value.year === parse(today).year;
  return t(sameYear ? dates.date : dates.dateWithYear, {
    ...nameParts(value),
    year: value.year,
  });
}

export function formatMonth(date: string): string {
  const { year, month } = parse(date);
  return t(dates.monthYear, { month: dates.months[month - 1], year });
}

export function formatDateRange(
  start: string,
  end: string,
  today: string,
): string {
  const from = parse(start);
  const to = parse(end);
  if (toDayNumber(to) < toDayNumber(from)) {
    throw new RangeError(`End "${end}" is before start "${start}"`);
  }
  if (start === end) return formatDate(start, today);
  const sameMonth = from.year === to.year && from.month === to.month;
  const { weekday, day } = nameParts(from);
  return t(dates.range, {
    start: sameMonth
      ? t(dates.rangeStart, { weekday, day })
      : formatDate(start, today),
    end: formatDate(end, today),
  });
}
