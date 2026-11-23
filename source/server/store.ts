import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one, run, transaction } from "./db.ts";
import { zone } from "./config.ts";
import { addDays, businessClock, clockTime, minutesIn, overlaps, toMinutes, workDay } from "../shared/time.ts";
import { bookingSchema, masterSchema, serviceSchema } from "../shared/validation.ts";
import type { Availability, Block, Booking, Business, Catalog, ManagedMaster, Service, Stat, Statistics, Status } from "../shared/types.ts";
import type { slotQuery } from "../shared/validation.ts";

export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const takenMessage = "Это время только что заняли, выберите другое";
export const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const businessTime = () => businessClock(zone);
export const settings = () => one<Business>("SELECT name,address,phone,gridStep,bookingDays,businessType FROM settings WHERE id=1")!;
export const services = (includeInactive = false) => all<Omit<Service, "active"> & { active: number }>(
  "SELECT id,name,description,durationMin,price,color,active FROM services WHERE archived=0 AND (active=1 OR ?) ORDER BY rowid", +includeInactive
).map(item => ({ ...item, active: !!item.active }));

export function masters(includeInactive = false): ManagedMaster[] {
  const links = all<{ masterId: string; serviceId: string }>("SELECT masterId,serviceId FROM master_services");
  return all<Omit<ManagedMaster, "workSchedule" | "active" | "serviceIds"> & { workSchedule: string; active: number }>(
    "SELECT id,name,phone,active,workSchedule,rotationFrom FROM masters WHERE archived=0 AND (active=1 OR ?) ORDER BY rowid", +includeInactive
  ).map(item => ({ ...item, active: !!item.active, workSchedule: masterSchema.shape.workSchedule.parse(JSON.parse(item.workSchedule)),
    serviceIds: links.filter(link => link.masterId === item.id).map(link => link.serviceId) }));
}

export function catalog(): Catalog {
  return { settings: settings(), services: services(), today: businessTime().date,
    masters: masters().map(({ id, name, serviceIds }) => ({ id, name, serviceIds })) };
}

const readBooking = `SELECT b.id,b.serviceId,b.masterId,b.clientName,b.clientPhone,b.date,b.startTime,b.endTime,b.status,b.comment,b.price,b.createdAt,
  s.name AS serviceName,s.description,s.durationMin,s.price AS servicePrice,s.color,s.active AS serviceActive,m.name AS masterName
  FROM bookings b JOIN services s ON s.id=b.serviceId JOIN masters m ON m.id=b.masterId`;
type BookingRow = Omit<Booking, "service" | "master"> & {
  serviceName: string; description: string; durationMin: number; servicePrice: number; color: string; serviceActive: number; masterName: string;
};
const materialize = ({ serviceName, description, durationMin, servicePrice, color, serviceActive, masterName, ...row }: BookingRow): Booking => ({
  ...row, service: { id: row.serviceId, name: serviceName, description, durationMin, price: servicePrice, color, active: !!serviceActive }, master: { name: masterName },
});
export const bookings = (from: string, to: string) => all<BookingRow>(
  readBooking + " WHERE b.deletedAt IS NULL AND b.date BETWEEN ? AND ? ORDER BY b.date,b.startTime", from, to
).map(materialize);
export const blocks = () => all<Block>("SELECT id,date,masterId FROM blocks WHERE deletedAt IS NULL ORDER BY date");

type BusyTimes = { start: string; end: string }[];

function daySlots(service: Service, master: ManagedMaster, date: string, current: ReturnType<typeof businessTime>,
  business: Business, busy: BusyTimes, blocked: boolean) {
  const shift = workDay(master.workSchedule, date, master.rotationFrom);
  if (blocked || !shift || date < current.date) return [];
  const occupied = [...shift.breaks, ...busy];
  const slots: string[] = [];
  for (let minute = toMinutes(shift.start); minute + service.durationMin <= toMinutes(shift.end); minute += business.gridStep) {
    const start = clockTime(minute);
    const end = clockTime(minute + service.durationMin);
    if (date === current.date && start + ":00" <= current.time + ":" + String(current.second).padStart(2, "0")) continue;
    if (occupied.every(item => !overlaps(item, { start, end }))) slots.push(start);
  }
  return slots;
}

export function available({ serviceId, masterId, date }: z.infer<typeof slotQuery>, admin = false) {
  const service = services().find(item => item.id === serviceId);
  const master = masters().find(item => item.id === masterId && item.serviceIds.includes(serviceId));
  if (!service || !master) throw new AppError(404, "Услуга или специалист больше недоступны");
  const current = businessTime();
  const business = settings();
  if (!admin && date >= addDays(current.date, business.bookingDays)) return { slots: [], service };
  const blocked = one("SELECT id FROM blocks WHERE deletedAt IS NULL AND date=? AND (masterId IS NULL OR masterId=?)", date, masterId);
  const busy = all<{ start: string; end: string }>(`SELECT startTime AS start,endTime AS end FROM bookings
    WHERE date=? AND masterId=? AND status<>'CANCELLED' AND deletedAt IS NULL`, date, masterId);
  return { slots: daySlots(service, master, date, current, business, busy, !!blocked), service };
}

export function publicAvailability(serviceId: string, masterId?: string): Availability {
  const service = services().find(item => item.id === serviceId);
  if (!service) throw new AppError(404, "Услуга больше недоступна");
  const candidates = masters().filter(item => item.serviceIds.includes(serviceId) && (!masterId || item.id === masterId));
  if (masterId && !candidates.length) throw new AppError(404, "Специалист больше недоступен для этой услуги");
  const current = businessTime();
  const business = settings();
  const until = addDays(current.date, business.bookingDays);
  const occupied = new Map<string, BusyTimes>();
  for (const item of all<{ date: string; masterId: string; start: string; end: string }>(`SELECT date,masterId,startTime AS start,endTime AS end
    FROM bookings WHERE date>=? AND date<? AND status<>'CANCELLED' AND deletedAt IS NULL`, current.date, until)) {
    const key = item.date + "/" + item.masterId;
    const ranges = occupied.get(key) ?? [];
    ranges.push({ start: item.start, end: item.end });
    occupied.set(key, ranges);
  }
  const closed = new Set(blocks().map(item => item.date + "/" + (item.masterId ?? "")));
  return Array.from({ length: business.bookingDays }, (_, index) => {
    const date = addDays(current.date, index);
    const times = new Map<string, string>();
    for (const master of candidates) {
      const key = date + "/" + master.id;
      for (const time of daySlots(service, master, date, current, business, occupied.get(key) ?? [], closed.has(date + "/") || closed.has(key))) {
        if (!times.has(time)) times.set(time, master.id);
      }
    }
    return { date, slots: Array.from(times, ([time, masterId]) => ({ time, masterId })).sort((a, b) => a.time.localeCompare(b.time)) };
  });
}

export function createBooking(input: z.infer<typeof bookingSchema>, admin = false) {
  return transaction(() => {
    const { slots, service } = available(input, admin);
    if (!slots.includes(input.startTime)) throw new AppError(409, takenMessage);
    const token = randomBytes(32).toString("hex");
    const id = randomUUID();
    const end = clockTime(toMinutes(input.startTime) + service.durationMin);
    run(`INSERT INTO bookings(id,serviceId,masterId,clientName,clientPhone,date,startTime,endTime,comment,price,tokenHash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, input.serviceId, input.masterId, input.clientName, input.clientPhone,
      input.date, input.startTime, end, input.comment, service.price, hash(token));
    return { id, token };
  });
}

export function tokenBooking(token: string) {
  const row = one<BookingRow>(readBooking + " WHERE b.tokenHash=? AND b.deletedAt IS NULL", hash(token));
  if (!row) throw new AppError(404, "Запись не найдена");
  return materialize(row);
}

export function cancel(token: string) {
  return transaction(() => {
    const booking = tokenBooking(token);
    if (booking.status === "CANCELLED") return;
    const now = businessTime();
    if (booking.date + booking.startTime <= now.date + now.time) throw new AppError(409, "Время записи уже наступило");
    changeStatus(booking.id, "CANCELLED");
  });
}

const transitions: Record<Status, Status[]> = {
  NEW: ["CONFIRMED", "CANCELLED", "NO_SHOW"], CONFIRMED: ["DONE", "CANCELLED", "NO_SHOW"], DONE: [], CANCELLED: [], NO_SHOW: [],
};
export function changeStatus(id: string, status: Status) {
  const row = one<{ status: Status }>("SELECT status FROM bookings WHERE id=? AND deletedAt IS NULL", id);
  if (!row) throw new AppError(404, "Запись не найдена");
  if (row.status === status) return;
  if (!transitions[row.status].includes(status)) throw new AppError(409, "Этот переход статуса недоступен");
  const result = run("UPDATE bookings SET status=? WHERE id=? AND status=? AND deletedAt IS NULL", status, id, row.status);
  if (!result.changes) throw new AppError(409, "Запись изменилась. Обновите ленту");
}

export function deleteBooking(id: string) {
  const result = run("UPDATE bookings SET deletedAt=? WHERE id=? AND deletedAt IS NULL", Date.now(), id);
  if (!result.changes) throw new AppError(404, "Запись не найдена");
}
export function undoBooking(id: string) {
  const result = run("UPDATE bookings SET deletedAt=NULL WHERE id=? AND deletedAt>=?", id, Date.now() - undoWindow);
  if (!result.changes) throw new AppError(409, "Время для восстановления истекло");
}

export function saveService(data: z.infer<typeof serviceSchema>, id?: string) {
  if (!id) {
    const created = randomUUID();
    run("INSERT INTO services(id,name,durationMin,price,color,active,description) VALUES(?,?,?,?,?,?,?)", created, data.name, data.durationMin, data.price, data.color, +data.active, data.description ?? "");
    return created;
  }
  const result = run("UPDATE services SET name=?,durationMin=?,price=?,color=?,active=?,description=coalesce(?,description) WHERE id=? AND archived=0",
    data.name, data.durationMin, data.price, data.color, +data.active, data.description ?? null, id);
  if (!result.changes) throw new AppError(404, "Услуга не найдена");
  return id;
}

export function saveMaster(data: z.infer<typeof masterSchema>, id?: string) {
  return transaction(() => {
    const valid = services(true);
    const chosen = [...new Set(data.serviceIds)];
    if (chosen.some(serviceId => !valid.some(item => item.id === serviceId))) throw new AppError(422, "Одна из услуг больше недоступна");
    const values = [data.name, data.phone, JSON.stringify(data.workSchedule), data.rotationFrom, +data.active] as const;
    const masterId = id ?? randomUUID();
    if (id) {
      const result = run("UPDATE masters SET name=?,phone=?,workSchedule=?,rotationFrom=?,active=? WHERE id=? AND archived=0", ...values, id);
      if (!result.changes) throw new AppError(404, "Мастер не найден");
      run("DELETE FROM master_services WHERE masterId=?", id);
    } else run("INSERT INTO masters(name,phone,workSchedule,rotationFrom,active,id) VALUES(?,?,?,?,?,?)", ...values, masterId);
    for (const serviceId of chosen) run("INSERT INTO master_services VALUES(?,?)", masterId, serviceId);
    return masterId;
  });
}

type Removable = "services" | "masters" | "blocks";
const undoWindow = 5000;
export function archive(table: Removable, id: string) {
  const filter = table === "blocks" ? "deletedAt IS NULL" : "archived=0";
  const field = table === "blocks" ? "deletedAt" : "archived";
  const result = run(`UPDATE ${table} SET ${field}=? WHERE id=? AND ${filter}`, Date.now(), id);
  if (!result.changes) throw new AppError(404, "Элемент не найден");
}
export function undoArchive(table: Removable, id: string) {
  const field = table === "blocks" ? "deletedAt" : "archived";
  const value = table === "blocks" ? null : 0;
  const result = run(`UPDATE ${table} SET ${field}=? WHERE id=? AND ${field}>=?`, value, id, Date.now() - undoWindow);
  if (!result.changes) throw new AppError(409, "Время для восстановления истекло");
}

export function statistics(from: string, to: string): Statistics {
  const items = bookings(from, to);
  const completed = items.filter(item => item.status === "DONE");
  const revenueBy = (subset: Booking[]) => subset.reduce((sum, item) => sum + item.price, 0);
  const days: Stat[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ name: date.slice(5).split("-").reverse().join("."), revenue: revenueBy(completed.filter(item => item.date === date)) });
  }
  const dates = blocks().filter(item => item.date >= from && item.date <= to);
  const masterMap = new Map(masters(true).map(item => [item.id, item.name]));
  for (const item of items) masterMap.set(item.masterId, item.master.name);
  const schedules = new Map(masters(true).map(item => [item.id, item]));
  const byMaster = Array.from(masterMap, ([id, name]) => {
    const master = schedules.get(id);
    let total = 0;
    let occupied = 0;
    const records = items.filter(item => item.masterId === id && item.status !== "CANCELLED");
    const intersection = (a: { start: string; end: string }, b: { start: string; end: string }) =>
      Math.max(0, Math.min(toMinutes(a.end), toMinutes(b.end)) - Math.max(toMinutes(a.start), toMinutes(b.start)));
    if (master) for (let date = from; date <= to; date = addDays(date, 1)) {
      const day = workDay(master.workSchedule, date, master.rotationFrom);
      if (day && !dates.some(item => item.date === date && (!item.masterId || item.masterId === id))) {
        total += minutesIn(day) - day.breaks.reduce((sum, item) => sum + minutesIn(item), 0);
        for (const item of records.filter(record => record.date === date)) {
          const range = { start: item.startTime, end: item.endTime };
          occupied += intersection(day, range) - day.breaks.reduce((sum, item) => sum + intersection(item, range), 0);
        }
      }
    }
    return { name, revenue: revenueBy(completed.filter(item => item.masterId === id)), utilization: total ? Math.min(100, Math.round(100 * occupied / total)) : 0 };
  });
  const serviceMap = new Map(services(true).map(item => [item.id, item.name]));
  for (const item of items) serviceMap.set(item.serviceId, item.service.name);
  return { revenue: revenueBy(completed), completed: completed.length, noShows: items.filter(item => item.status === "NO_SHOW").length,
    days, services: Array.from(serviceMap, ([id, name]) => ({ name, revenue: revenueBy(completed.filter(item => item.serviceId === id)) })), masters: byMaster };
}
