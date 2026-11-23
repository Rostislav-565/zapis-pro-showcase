import { randomUUID } from "node:crypto";
import { addDays, clockTime, overlaps, toMinutes, workDay } from "../shared/time.ts";
import type { Schedule, Status, WorkDay } from "../shared/types.ts";
import { passwordHash } from "./auth.ts";
import { one, run, transaction } from "./db.ts";
import { businessTime, hash, masters, saveMaster, saveService, services } from "./store.ts";

const demoServices = [
  ["Стрижка", 45, 1200, "#22c55e"], ["Оформление бороды", 30, 800, "#f59e0b"],
  ["Стрижка и борода", 75, 1800, "#a78bfa"], ["Стрижка машинкой", 30, 900, "#60a5fa"],
  ["Королевское бритьё", 45, 1300, "#fb7185"], ["Детская стрижка", 45, 1000, "#2dd4bf"],
] as const;
const demoMasters = ["Артём Волков", "Максим Орлов", "Илья Соколов", "Даниил Кравцов"];
const clients = ["Сергей Панов", "Никита Рыбаков", "Алексей Демин", "Кирилл Власов", "Евгений Захаров",
  "Антон Громов", "Павел Смирнов", "Владимир Котов", "Олег Воронов", "Роман Егоров"];
const statuses: Status[] = ["NEW", "CONFIRMED", "DONE", "CANCELLED", "NO_SHOW"];
const shift = (start: string, end: string, lunch: string): WorkDay => ({
  start, end, breaks: [{ start: lunch, end: clockTime(toMinutes(lunch) + 30) }],
});
const weekly = (days: number[], work: WorkDay): Schedule => Object.fromEntries(days.map(day => [String(day), work]));
transaction(() => {
  const login = process.env.ADMIN_LOGIN || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  run("INSERT OR IGNORE INTO admins VALUES(?,?)", login, passwordHash(password));
  if (one("SELECT key FROM metadata WHERE key='demo_seed'")) return;
  const descriptions = [
    "Мытьё головы и укладка входят в стоимость", "Коррекция формы и контура",
    "Стрижка волос и оформление бороды", "Стрижка одной или двумя насадками",
    "Бритьё с горячим полотенцем", "Для детей до 12 лет",
  ];
  demoServices.forEach(([name, durationMin, price, color], index) =>
    saveService({ name, durationMin, price, color, description: descriptions[index], active: true }));
  run("INSERT INTO metadata VALUES('demo_seed','1')");
});
const today = businessTime().date;
transaction(() => {
  if (one("SELECT key FROM metadata WHERE key='demo_bookings'")) return;
  const list = services();
  const schedules = [
    weekly([1, 2, 3, 4, 5], shift("09:00", "19:00", "13:00")),
    { rotation: shift("10:00", "20:00", "14:00") },
    weekly([2, 3, 4, 5, 6], shift("11:00", "21:00", "15:00")),
    weekly([0, 3, 4, 5, 6], shift("10:00", "19:00", "13:30")),
  ];
  demoMasters.forEach((name, index) => saveMaster({
    name, phone: "+7927000100" + index, active: true, workSchedule: schedules[index],
    rotationFrom: index === 1 ? today : null, serviceIds: list.filter((_, item) => (index + item) % 5 !== 4).map(item => item.id),
  }));
  transaction(() => {
    let count = 0;
    for (let offset = 1; offset <= 7 && count < 25; offset++) {
      const date = addDays(today, offset);
      for (const master of masters()) {
        const work = workDay(master.workSchedule, date, master.rotationFrom);
        if (!work) continue;
        const eligible = list.filter(item => master.serviceIds.includes(item.id));
        for (const hour of [1, 6]) {
          if (count >= 25) break;
          const service = eligible[count % eligible.length];
          const start = clockTime(toMinutes(work.start) + hour * 60);
          const end = clockTime(toMinutes(start) + service.durationMin);
          if (end > work.end || work.breaks.some(item => overlaps(item, { start, end }))) continue;
          run(`INSERT INTO bookings(id,serviceId,masterId,clientName,clientPhone,date,startTime,endTime,status,price,tokenHash)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`, randomUUID(), service.id, master.id, clients[count % clients.length], "+790012300" + String(count).padStart(2, "0"),
            date, start, end, statuses[count % statuses.length], service.price, hash(randomUUID()));
          count++;
        }
      }
    }
    if (count !== 25) throw new Error("Недостаточно демонстрационных слотов");
    run("INSERT INTO blocks(id,date,masterId) VALUES(?,?,NULL)", randomUUID(), addDays(today, 9));
    run("INSERT INTO blocks(id,date,masterId) VALUES(?,?,?)", randomUUID(), addDays(today, 11), masters()[1].id);
    run("INSERT INTO metadata VALUES('demo_bookings','1')");
  });
});
console.log("Демо-данные готовы.");
