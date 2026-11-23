import { z } from "zod";
import { dateObject, normalizedPhone, overlaps } from "./time.ts";

export const idSchema = z.string().trim().min(1, "Выберите значение").max(80, "Слишком длинное значение");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату").refine(value => {
  const date = dateObject(value);
  return value >= "2000-01-01" && value <= "2099-12-31" &&
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Укажите корректную дату");
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время");
const text = (min: number, max: number, message: string) =>
  z.string().trim().min(min, message).max(max, "Слишком длинное значение");
export const phone = z.string().trim().max(24, "Укажите телефон в формате +7 (999) 123-45-67")
  .transform((value, ctx) => {
    const result = normalizedPhone(value);
    if (result) return result;
    ctx.addIssue({ code: "custom", message: "Укажите телефон в формате +7 (999) 123-45-67" });
    return z.NEVER;
  });
export const slotQuery = z.object({ serviceId: idSchema, masterId: idSchema, date: dateSchema });
export const bookingSchema = slotQuery.extend({
  startTime: timeSchema,
  clientName: text(2, 80, "Введите имя, минимум 2 символа"),
  clientPhone: phone,
  comment: text(0, 500, "").default(""),
});
export const serviceSchema = z.object({
  description: text(0, 240, "").optional(),
  name: text(2, 80, "Введите название, минимум 2 символа"),
  durationMin: z.coerce.number().int().min(5, "Минимум 5 минут").max(720, "Максимум 720 минут"),
  price: z.coerce.number().int().min(0, "Цена должна быть неотрицательной").max(1000000, "Максимум 1 000 000 ₽"),
  color: z.string().regex(/^#[\da-f]{6}$/i, "Выберите цвет"),
  active: z.boolean(),
});
const range = z.object({ start: timeSchema, end: timeSchema }).refine(value => value.start < value.end, "Время окончания должно быть позже начала");
const day = z.object({ start: timeSchema, end: timeSchema, breaks: z.array(range).max(12, "Максимум 12 перерывов") }).superRefine((value, ctx) => {
  if (value.start >= value.end) ctx.addIssue({ code: "custom", path: ["end"], message: "Время окончания должно быть позже начала" });
  value.breaks.forEach((item, index) => {
    if (item.start < value.start || item.end > value.end) ctx.addIssue({ code: "custom", path: ["breaks", index], message: "Перерыв должен быть внутри смены" });
    if (value.breaks.slice(0, index).some(previous => overlaps(item, previous))) ctx.addIssue({ code: "custom", path: ["breaks", index], message: "Перерывы пересекаются" });
  });
});
export const scheduleSchema = z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6", "rotation"]), day.nullable());
export const masterSchema = z.object({
  name: text(2, 80, "Введите имя мастера, минимум 2 символа"),
  phone,
  active: z.boolean(),
  serviceIds: z.array(idSchema).max(150, "Слишком много услуг"),
  workSchedule: scheduleSchema,
  rotationFrom: dateSchema.nullable(),
}).superRefine((value, ctx) => {
  if (value.rotationFrom && !value.workSchedule.rotation) ctx.addIssue({ code: "custom", path: ["workSchedule", "rotation"], message: "Укажите часы смены" });
});
export const settingsSchema = z.object({
  businessType: z.enum(["barber", "auto", "tutor", "other"]).optional(),
  name: text(2, 120, "Введите название бизнеса"),
  address: text(2, 240, "Введите адрес"),
  phone,
  gridStep: z.coerce.number().int().min(5, "Минимум 5 минут").max(120, "Максимум 120 минут"),
  bookingDays: z.coerce.number().int().min(1, "Минимум 1 день").max(90, "Максимум 90 дней"),
});
export const periodSchema = z.object({ from: dateSchema, to: dateSchema }).refine(value => {
  const range = dateObject(value.to).getTime() - dateObject(value.from).getTime();
  return range >= 0 && range <= 365 * 86400000;
}, { path: ["to"], message: "Укажите период до 366 дней с датой окончания после начала" });
