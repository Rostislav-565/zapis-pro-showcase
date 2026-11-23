import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { addDays } from "../shared/time.ts";
import { statuses } from "../shared/types.ts";
import { bookingSchema, dateSchema, idSchema, masterSchema, periodSchema, serviceSchema, settingsSchema, slotQuery } from "../shared/validation.ts";
import { hasSession, login, logout, requireAdmin } from "./auth.ts";
import { one, run } from "./db.ts";
import { calendarFile, csvFile } from "./files.ts";
import * as store from "./store.ts";

const idToken = z.string().regex(/^[0-9a-f]{64}$/);
const status = z.enum(Object.keys(statuses) as (keyof typeof statuses)[]);
const bodyLimit = 32 * 1024;
async function payload(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new store.AppError(415, "Требуется формат JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > bodyLimit) throw new store.AppError(413, "Запрос слишком большой");
    chunks.push(data);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new store.AppError(400, "Не удалось прочитать запрос"); }
}
const send = (res: ServerResponse, data: unknown, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
function download(res: ServerResponse, data: string, filename: string, type: string) {
  res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Content-Disposition": 'attachment; filename="' + filename + '"' });
  res.end(data);
}
function checkOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (req.headers["sec-fetch-site"] === "cross-site" || (origin && origin !== "http://" + req.headers.host && origin !== "https://" + req.headers.host)) {
    throw new store.AppError(403, "Запрос с другого сайта отклонён");
  }
}
export async function api(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const { pathname, searchParams } = new URL(req.url || "/", "http://local");
    const [, , area, action, rawId, extra, ...rest] = pathname.split("/");
    const method = req.method;
    if (method !== "GET") checkOrigin(req);
    if (rest.length) throw new store.AppError(404, "Маршрут не найден");
    const query = Object.fromEntries(searchParams);
    if (area === "catalog" && !action && method === "GET") return send(res, store.catalog());
    if (area === "availability" && !action && method === "GET") {
      const { serviceId, masterId } = z.object({ serviceId: idSchema, masterId: idSchema.optional() }).parse(query);
      return send(res, store.publicAvailability(serviceId, masterId));
    }
    if (area === "slots" && !action && method === "GET") return send(res, store.available(slotQuery.parse(query)).slots);
    if (area === "booking") {
      if (method === "POST" && !action) return send(res, store.createBooking(bookingSchema.parse(await payload(req))), 201);
      if (action) {
        const token = idToken.parse(action);
        if (method === "GET" && !rawId) return send(res, { booking: store.tokenBooking(token), settings: store.settings() });
        if (method === "GET" && rawId === "calendar.ics" && !extra) return download(res,
          calendarFile(store.tokenBooking(token), store.settings()), "zapis-pro.ics", "text/calendar");
        if (method === "POST" && rawId === "cancel" && !extra) {
          store.cancel(token);
          return send(res, { ok: true });
        }
      }
    }
    if (area === "admin") {
      if (action === "login" && !rawId && method === "POST") {
        const input = z.object({ login: z.string().trim().min(1, "Введите логин").max(80), password: z.string().min(1, "Введите пароль").max(256) }).parse(await payload(req));
        res.setHeader("Set-Cookie", login(req, input.login, input.password));
        return send(res, { ok: true });
      }
      if (action === "session" && !rawId && method === "GET") {
        return send(res, { today: hasSession(req) ? store.businessTime().date : null });
      }
      requireAdmin(req);
      if (!rawId && method === "GET") {
        if (action === "slots") return send(res, store.available(slotQuery.parse(query), true).slots);
        if (action === "data" || action === "stats" || action === "export") {
          const { from, to } = periodSchema.parse(query);
          if (action === "stats") return send(res, store.statistics(from, to));
          const bookings = store.bookings(from, to);
          if (action === "export") return download(res, csvFile(bookings), "zapis-pro-" + from + "-" + to + ".csv", "text/csv");
          return send(res, { bookings, settings: store.settings(), services: store.services(true), masters: store.masters(true), blocks: store.blocks() });
        }
      }
      if (action === "logout" && !rawId && method === "POST") {
        res.setHeader("Set-Cookie", logout(req));
        return send(res, { ok: true });
      }
      const id = rawId ? idSchema.parse(rawId) : undefined;
      if (action === "bookings") {
        if (method === "POST" && !id) return send(res, store.createBooking(bookingSchema.parse(await payload(req)), true), 201);
        if (id && !extra && method === "PATCH") store.changeStatus(id, z.object({ status }).parse(await payload(req)).status);
        else if (id && !extra && method === "DELETE") store.deleteBooking(id);
        else if (id && extra === "undo" && method === "POST") store.undoBooking(id);
        else throw new store.AppError(404, "Маршрут не найден");
        return send(res, { ok: true });
      }
      if ((action === "services" || action === "masters" || action === "blocks") && id) {
        if (!extra && method === "DELETE") {
          store.archive(action, id);
          return send(res, { ok: true });
        }
        if (extra === "undo" && method === "POST") {
          store.undoArchive(action, id);
          return send(res, { ok: true });
        }
      }
      if ((action === "services" || action === "masters") && !extra) {
        if ((!id && method === "POST") || (id && method === "PUT")) {
          const input = await payload(req);
          const saved = action === "services" ? store.saveService(serviceSchema.parse(input), id) : store.saveMaster(masterSchema.parse(input), id);
          return send(res, { id: saved }, id ? 200 : 201);
        }

      }
      if (action === "settings" && !id && method === "PUT") {
        const input = settingsSchema.parse(await payload(req));
        run("UPDATE settings SET name=?,address=?,phone=?,gridStep=?,bookingDays=?,businessType=coalesce(?,businessType) WHERE id=1",
          input.name, input.address, input.phone, input.gridStep, input.bookingDays, input.businessType ?? null);
        return send(res, { ok: true });
      }
      if (action === "blocks" && !extra) {
        if (!id && method === "POST") {
          const { date, masterId } = z.object({ date: dateSchema, masterId: idSchema.nullable() }).parse(await payload(req));
          if (masterId && !one("SELECT id FROM masters WHERE id=? AND archived=0", masterId)) throw new store.AppError(404, "Мастер не найден");
          run("INSERT INTO blocks(id,date,masterId) VALUES(?,?,?)", randomUUID(), date, masterId);
          return send(res, { ok: true }, 201);
        }

      }
    }
    throw new store.AppError(404, "Маршрут не найден");
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fields = Object.fromEntries(error.issues.map(issue => [issue.path.join("."), /[А-Яа-яЁё]/.test(issue.message) ? issue.message : "Проверьте значение поля"]));
      return send(res, { message: Object.values(fields)[0] || "Проверьте введённые данные", fields }, 422);
    }
    if (error instanceof store.AppError) return send(res, { message: error.message }, error.status);
    if (error instanceof Error && /ZAPIS_OVERLAP|booking_slot|bookings\.masterId|database is locked/.test(error.message)) {
      return send(res, { message: store.takenMessage }, 409);
    }
    if (error instanceof Error && /blocks_scope/.test(error.message)) return send(res, { message: "Дата уже заблокирована" }, 409);
    console.error(error);
    send(res, { message: "Ошибка сервера. Попробуйте ещё раз" }, 500);
  }
}
