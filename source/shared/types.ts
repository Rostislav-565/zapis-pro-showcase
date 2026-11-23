import type { BusinessType } from "./business.ts";

export const statuses = {
  NEW: "Новая",
  CONFIRMED: "Подтверждена",
  DONE: "Завершена",
  CANCELLED: "Отменена",
  NO_SHOW: "Неявка",
} as const;
export type Status = keyof typeof statuses;
export type TimeRange = { start: string; end: string };
export type WorkDay = TimeRange & { breaks: TimeRange[] };
export type Schedule = Record<string, WorkDay | null>;
export type Business = { name: string; businessType: BusinessType; address: string; phone: string; gridStep: number; bookingDays: number };
export type Service = { id: string; name: string; description: string; durationMin: number; price: number; color: string; active: boolean };
export type Master = { id: string; name: string; serviceIds: string[] };
export type ManagedMaster = Master & { phone: string; active: boolean; workSchedule: Schedule; rotationFrom: string | null };
export type Booking = {
  id: string; serviceId: string; masterId: string; clientName: string; clientPhone: string; date: string;
  startTime: string; endTime: string; status: Status; comment: string; price: number; createdAt: string;
  service: Service; master: { name: string };
};
export type Block = { id: string; date: string; masterId: string | null };
export type Catalog = { settings: Business; services: Service[]; masters: Master[]; today: string };
export type AdminData = { settings: Business; services: Service[]; masters: ManagedMaster[]; bookings: Booking[]; blocks: Block[] };
export type Stat = { name: string; revenue: number };
export type Statistics = { revenue: number; completed: number; noShows: number; days: Stat[]; services: Stat[]; masters: (Stat & { utilization: number })[] };


export type SlotChoice = { time: string; masterId: string };
export type Availability = { date: string; slots: SlotChoice[] }[];
