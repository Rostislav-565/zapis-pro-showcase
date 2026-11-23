import { zone } from "./config.ts";
import { zonedInstant } from "../shared/time.ts";
import type { Booking, Business } from "../shared/types.ts";
import { statuses } from "../shared/types.ts";

const escapeCalendar = (text: string) => text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[;,]/g, "\\$&");
const stamp = (value: Date) => value.toISOString().replace(/[-:]|\.\d{3}/g, "");

function fold(line: string) {
  let value = "";
  let size = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > 75) { value += "\r\n "; size = 1; }
    value += character;
    size += bytes;
  }
  return value;
}

export function calendarFile(booking: Booking, business: Business) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZapisPro//Booking//RU", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", "UID:" + booking.id + "@zapis-pro.local", "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(zonedInstant(booking.date, booking.startTime, zone)),
    "DTEND:" + stamp(zonedInstant(booking.date, booking.endTime, zone)),
    "SUMMARY:" + escapeCalendar(booking.service.name + " — " + business.name),
    "LOCATION:" + escapeCalendar(business.address),
    "DESCRIPTION:" + escapeCalendar("Мастер — " + booking.master.name + "\nТелефон — " + business.phone),
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}

export function csvFile(bookings: Booking[]) {
  const quote = (value: string | number) => {
    const text = String(value);
    return '"' + (/^[\s]*[=+\-@]|^[\r\n\t]/.test(text) ? "'" : "") + text.replace(/"/g, '""') + '"';
  };
  const rows = [
    ["Дата", "Начало", "Окончание", "Услуга", "Мастер", "Клиент", "Телефон", "Статус", "Цена, ₽", "Комментарий"],
    ...bookings.map(item => [item.date, item.startTime, item.endTime, item.service.name, item.master.name,
      item.clientName, item.clientPhone, statuses[item.status], item.price, item.comment]),
  ];
  return "\uFEFF" + rows.map(row => row.map(quote).join(";")).join("\r\n") + "\r\n";
}
