import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { addDays } from "../shared/time.ts";
import type { AdminData, Availability, Catalog, Statistics } from "../shared/types.ts";

process.env.ZAPIS_DB = ":memory:";
process.env.ADMIN_LOGIN = "admin";
process.env.ADMIN_PASSWORD = "admin123";
const { api } = await import("../server/api.ts");
const { db, run } = await import("../server/db.ts");
await import("../server/seed.ts");

test("SQLite и API: запись, гонка, статусы, график, CSV, undo, отмена", async t => {
  const server = createServer(api);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => { server.close(); db.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port + "/api/";
  let cookie = "";
  const send = (path: string, method = "GET", body?: unknown, admin = false) => fetch(base + path, {
    method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(admin ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await send("admin/stats")).status, 401);
  assert.equal((await send("admin/services", "POST", {})).status, 401);
  const login = await send("admin/login", "POST", { login: "admin", password: "admin123" });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const catalog: Catalog = await (await send("catalog")).json();
  assert.equal(catalog.services.length, 6);
  assert.equal(catalog.masters.length, 4);
  const first = addDays(catalog.today, 1);
  const last = addDays(catalog.today, 7);
  const period = "from=" + first + "&to=" + last;
  const adminData = async (): Promise<AdminData> => (await send("admin/data?" + period, "GET", undefined, true)).json();
  const stats = async (): Promise<Statistics> => (await send("admin/stats?" + period, "GET", undefined, true)).json();
  const demo = await adminData();
  assert.equal(demo.bookings.length, 25);
  assert.equal(new Set(demo.bookings.map(item => item.status)).size, 5);
  assert.equal(demo.blocks.length, 2);
  const service = catalog.services[0];
  const master = catalog.masters[0];
  const book = { date: first, serviceId: service.id, masterId: master.id, clientName: "Иван Тестов", clientPhone: "+7 (999) 111-22-33", startTime: "" };
  const listSlots = async (date: string): Promise<string[]> => (await send("slots?" + new URLSearchParams({ serviceId: service.id, masterId: master.id, date }))).json();
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const slots = await listSlots(date);
    if (slots.length) { book.date = date; book.startTime = slots[0]; break; }
  }
  assert.ok(book.startTime);
  const availabilityRequest = await send("availability?serviceId=" + service.id);
  assert.equal(availabilityRequest.status, 200);
  const calendar: Availability = await availabilityRequest.json();
  assert.equal(calendar.length, catalog.settings.bookingDays);
  assert.ok(calendar.some(day => day.slots.length));
  for (const day of calendar) {
    assert.deepEqual(day.slots.map(slot => slot.time), [...new Set(day.slots.map(slot => slot.time))].sort());
  }
  assert.deepEqual(calendar.find(day => day.date === demo.blocks[0].date)?.slots, []);
  const filtered: Availability = await (await send("availability?serviceId=" + service.id + "&masterId=" + master.id)).json();
  assert.deepEqual(filtered.find(day => day.date === book.date)?.slots.map(slot => slot.time), await listSlots(book.date));
  assert.deepEqual(await listSlots(demo.blocks[0].date), []);
  const invalid = await send("booking", "POST", { ...book, clientPhone: "123" });
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).fields.clientPhone, /телефон/);
  const races = await Promise.all([send("booking", "POST", book), send("booking", "POST", book)]);
  assert.deepEqual(races.map(item => item.status).sort(), [201, 409]);
  assert.equal((await races.find(item => item.status === 409)!.json()).message, "Это время только что заняли, выберите другое");
  const { id, token } = await races.find(item => item.status === 201)!.json() as { id: string; token: string };
  assert.equal((await listSlots(book.date)).includes(book.startTime), false);
  const saved = (await adminData()).bookings.find(item => item.id === id)!;
  assert.equal(saved.clientPhone, "+79991112233");
  assert.ok(saved.createdAt);
  assert.throws(() => run(`INSERT INTO bookings(id,serviceId,masterId,clientName,clientPhone,date,startTime,endTime,price,tokenHash)
    VALUES('test-overlap',?,?, 'Проверка', '+79991112233',?,?,?,0,'test-overlap')`, saved.serviceId, saved.masterId, saved.date,
    saved.startTime.slice(0, 3) + (saved.startTime.endsWith("00") ? "05" : "35"), saved.endTime), /ZAPIS_OVERLAP/);
  const ics = await send("booking/" + token + "/calendar.ics");
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-disposition")!, /\.ics/);
  assert.match(await ics.text(), /BEGIN:VCALENDAR\r\n[\s\S]+DTSTART:\d{8}T\d{6}Z/);
  const before = await stats();
  assert.equal((await send("admin/bookings/" + id, "PATCH", { status: "CONFIRMED" }, true)).status, 200);
  assert.equal((await send("admin/bookings/" + id, "PATCH", { status: "DONE" }, true)).status, 200);
  const after = await stats();
  assert.equal(after.revenue, before.revenue + service.price);
  assert.equal(after.completed, before.completed + 1);
  const csv = await send("admin/export?" + period, "GET", undefined, true);
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  assert.equal(csvBytes.subarray(0, 3).toString("hex"), "efbbbf");
  assert.match(csvBytes.toString(), /"Клиент";"Телефон";"Статус"[\s\S]*"Иван Тестов"/);
  assert.equal((await send("admin/bookings/" + id, "DELETE", undefined, true)).status, 200);
  assert.ok(!(await adminData()).bookings.some(item => item.id === id));
  assert.equal((await send("admin/bookings/" + id + "/undo", "POST", undefined, true)).status, 200);
  assert.ok((await adminData()).bookings.some(item => item.id === id));
  await send("admin/bookings/" + id, "DELETE", undefined, true);
  run("UPDATE bookings SET deletedAt=? WHERE id=?", Date.now() - 5500, id);
  assert.equal((await send("admin/bookings/" + id + "/undo", "POST", undefined, true)).status, 409);
  const second = await send("booking", "POST", book);
  assert.equal(second.status, 201);
  const secondToken = (await second.json()).token;
  assert.equal((await send("booking/" + secondToken + "/cancel", "POST")).status, 200);
  assert.ok((await listSlots(book.date)).includes(book.startTime));
  const created = await send("admin/services", "POST", { name: "Укладка", durationMin: 30, price: 650, color: "#55aabb", active: true }, true);
  assert.equal(created.status, 201);
  const serviceId = (await created.json()).id;
  assert.equal((await send("admin/services/" + serviceId, "DELETE", undefined, true)).status, 200);
  assert.equal((await send("admin/services/" + serviceId + "/undo", "POST", undefined, true)).status, 200);
  const blocked = demo.blocks[0];
  assert.equal((await send("admin/blocks/" + blocked.id, "DELETE", undefined, true)).status, 200);
  assert.equal((await send("admin/blocks/" + blocked.id + "/undo", "POST", undefined, true)).status, 200);
  const manualDate = addDays(book.date, 35);
  const manualSlotsResponse = await send("admin/slots?" + new URLSearchParams({ serviceId: service.id, masterId: master.id, date: manualDate }), "GET", undefined, true);
  assert.equal(manualSlotsResponse.status, 200);
  const manualSlots: string[] = await manualSlotsResponse.json();
  assert.ok(manualSlots.length);
  assert.equal((await send("admin/bookings", "POST", { ...book, date: manualDate, startTime: manualSlots[0] }, true)).status, 201);
  assert.deepEqual(await listSlots(manualDate), []);
  const managed = demo.masters.find(item => item.id === master.id)!;
  const weekday = String(new Date(book.date + "T12:00:00Z").getUTCDay());
  assert.equal((await send("admin/masters/" + master.id, "PUT", { ...managed, workSchedule: { ...managed.workSchedule, [weekday]: null } }, true)).status, 200);
  assert.deepEqual(await listSlots(book.date), []);
  assert.equal((await send("admin/logout", "POST", undefined, true)).status, 200);
  assert.equal((await send("admin/data?" + period, "GET", undefined, true)).status, 401);
});
