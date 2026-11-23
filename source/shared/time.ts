import type { Schedule, TimeRange } from "./types.ts";

export const weekNames = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
export const weekOrder = [1, 2, 3, 4, 5, 6, 0];
export const dateObject = (date: string) => new Date(date + "T12:00:00Z");
export const addDays = (date: string, offset: number) => {
  const result = dateObject(date);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
};
export const displayDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(dateObject(date));
export const money = (amount: number) => new Intl.NumberFormat("ru-RU").format(amount) + " ₽";
export const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const clockTime = (minutes: number) =>
  String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
export const overlaps = (a: TimeRange, b: TimeRange) => a.start < b.end && a.end > b.start;
export const minutesIn = (range: TimeRange) => toMinutes(range.end) - toMinutes(range.start);

export function workDay(schedule: Schedule, date: string, rotationFrom?: string | null) {
  if (rotationFrom) {
    const elapsed = Math.round((dateObject(date).getTime() - dateObject(rotationFrom).getTime()) / 86400000);
    if ((elapsed % 4 + 4) % 4 >= 2) return null;
    return schedule["rotation"] ?? null;
  }
  return schedule[String(dateObject(date).getUTCDay())] ?? null;
}

export function businessClock(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)?.value ?? "";
  return { date: [get("year"), get("month"), get("day")].join("-"), time: get("hour") + ":" + get("minute"),
    second: Number(get("second")) };
}

export function zonedInstant(date: string, time: string, zone: string) {
  const desired = Date.parse(date + "T" + time + ":00Z");
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const observed = businessClock(zone, new Date(guess));
    const difference = desired - Date.parse(observed.date + "T" + observed.time + ":00Z");
    if (!difference) break;
    guess += difference;
  }
  return new Date(guess);
}

export function phoneMask(value: string) {
  if (!value) return "";
  const raw = value.replace(/\D/g, "");
  const digits = (value.startsWith("+7") || (raw.length === 11 && /^[78]/.test(raw)) ? raw.slice(1) : raw).slice(0, 10);
  if (!digits && !raw) return "";
  let result = "+7";
  if (digits.length) result += " (" + digits.slice(0, 3);
  if (digits.length > 3) result += ") " + digits.slice(3, 6);
  if (digits.length > 6) result += "-" + digits.slice(6, 8);
  if (digits.length > 8) result += "-" + digits.slice(8, 10);
  return result;
}
export function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^[78]\d{10}$/.test(digits) ? "+7" + digits.slice(1) : null;
}
