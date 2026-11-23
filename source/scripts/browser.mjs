import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

if (!process.env.ZAPIS_PLAYWRIGHT) throw new Error("Укажите ZAPIS_PLAYWRIGHT — путь к index.mjs установленного playwright-core");
const { chromium } = await import(pathToFileURL(process.env.ZAPIS_PLAYWRIGHT));
const output = resolve("verification-output");
await mkdir(output, { recursive: true });
const env = { ...process.env, ZAPIS_DB: resolve(output, "browser-" + Date.now() + ".db"),
  ADMIN_LOGIN: "admin", ADMIN_PASSWORD: "admin123", SESSION_SECURE: "false" };
const base = "http://127.0.0.1:5191";
const proc = (file, args) => spawn(process.execPath, [file, ...args], { env, stdio: "inherit" });
const exit = child => new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolve() : reject(new Error("Процесс завершился с кодом " + code)));
});
await exit(proc("server/seed.ts", []));
const server = proc("node_modules/vite/bin/vite.js", ["--host", "127.0.0.1", "--port", "5191", "--strictPort"]);
let browser;
try {
  let data;
  for (let n = 0; n < 40; n++) {
    try { data = await (await fetch(base + "/api/catalog")).json(); break; } catch { await sleep(150); }
  }
  assert.ok(data, "Dev-сервер не ответил");
  browser = await chromium.launch({ executablePath: process.env.ZAPIS_CHROME ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", entry => { if (entry.type() === "error" && !entry.text().startsWith("Failed to load resource:")) errors.push(entry.text()); });
  const button = name => page.getByRole("button", { name, exact: true });
  const visible = locator => locator.waitFor({ state: "visible" });
  const width = async (label, size) => {
    const dims = await page.evaluate(() => ({
      width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      clipped: Array.from(document.querySelectorAll(".brand, .client-intro, .client-service, .client-sidebar, .toolbar, .admin-nav, .timeline"))
        .filter(el => el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1).map(el => el.className),
    }));
    assert.deepEqual(dims, { width: size, scroll: size, clipped: [] }, label);
  };

  await page.goto(base);
  await visible(page.getByRole("heading", { name: "Выберите услугу" }));
  await page.evaluate(() => document.fonts.ready);
  await width("Витрина 1440", 1440);
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 360, height: 840 });
  await width("Витрина 360", 360);
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true });
  await button("Светлая тема").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await button("Тёмная тема").click();
  await page.locator(".client-service").first().click();
  const service = data.services[0];
  assert.equal(await page.getByLabel("Мастер", { exact: true }).inputValue(), "");
  const allUrl = base + "/api/availability?serviceId=" + service.id;
  const allDays = await (await context.request.get(allUrl)).json();
  const nearest = allDays.find(item => item.slots.length);
  await visible(page.locator(".slot").first());
  assert.equal(await page.locator(".client-days button[aria-pressed='true']").getAttribute("aria-label"),
    new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(nearest.date + "T12:00:00Z")));
  assert.equal((await page.locator(".slot").first().textContent()).trim(), nearest.slots[0].time);
  const master = data.masters.find(item => item.serviceIds.includes(service.id));
  await page.getByLabel("Мастер", { exact: true }).selectOption(master.id);
  const slotPath = date => "/api/slots?" + new URLSearchParams({ date, serviceId: service.id, masterId: master.id });
  const specific = await (await context.request.get(allUrl + "&masterId=" + master.id)).json();
  const target = specific.find(item => item.date > data.today && item.slots.length);
  const date = target.date;
  const offset = specific.indexOf(target);
  await page.locator(".client-days button").nth(offset).click();
  await visible(page.locator(".slot").first());
  await width("Календарь 360", 360);
  const calendar = await page.locator(".days").evaluate(element => element.scrollWidth > element.clientWidth);
  assert.ok(calendar);
  await page.screenshot({ path: resolve(output, "calendar-mobile.png"), fullPage: true });
  const slot = (await page.locator(".slot").first().textContent()).trim();
  await button(slot).click();
  await button("Подтвердить запись").click();
  await visible(page.getByText("Введите имя, минимум 2 символа", { exact: true }));
  const rival = await context.newPage();
  await rival.goto(base);
  await rival.locator(".client-service").first().click();
  await rival.getByLabel("Мастер", { exact: true }).selectOption(master.id);
  await rival.locator(".client-days button").nth(offset).click();
  await rival.getByRole("button", { name: slot, exact: true }).click();
  await rival.getByLabel("Имя", { exact: true }).fill("Второй Клиент");
  await rival.getByLabel("Телефон", { exact: true }).fill("9991002000");
  const client = "Иван Браузеров";
  await page.getByLabel("Имя", { exact: true }).fill(client);
  await page.getByLabel("Телефон", { exact: true }).fill("9991234567");
  assert.equal(await page.getByLabel("Телефон", { exact: true }).inputValue(), "+7 (999) 123-45-67");
  await button("Подтвердить запись").click();
  await page.waitForURL("**/confirmation/**");
  await visible(page.getByRole("heading", { name: "Вы записаны!" }));
  const [ics] = await Promise.all([page.waitForEvent("download"), button("Добавить в календарь").click()]);
  assert.equal(ics.suggestedFilename(), "zapis-pro.ics");
  assert.match(await readFile(await ics.path(), "utf8"), /BEGIN:VCALENDAR[\s\S]*DTSTART:/);
  await rival.getByRole("button", { name: "Подтвердить запись", exact: true }).click();
  await visible(rival.getByText("Это время только что заняли, выберите другое", { exact: true }));
  assert.equal(await rival.locator(".slots").getByRole("button", { name: slot, exact: true }).count(), 0);
  await rival.close();
  const cancellation = await page.getByRole("link", { name: "Отменить запись" }).getAttribute("href");
  assert.match(cancellation, /^\/cancel\/[a-f0-9]{64}$/);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Вход для сотрудников" }).click();
  await page.getByLabel("Логин").fill("admin");
  await page.getByLabel("Пароль").fill("admin123");
  await button("Войти").click();
  await visible(page.getByRole("heading", { name: "Календарь записей" }));
  await page.getByLabel("Дата календаря").fill(date);
  const card = page.locator(".appointment").filter({ hasText: client });
  await visible(card);
  await width("Панель 1440", 1440);
  await page.screenshot({ path: resolve(output, "admin-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 360, height: 840 });
  await width("Панель 360", 360);
  await card.click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await visible(modal.getByText("Подтверждена", { exact: true }));
  await modal.getByRole("button", { name: "Завершить", exact: true }).click();
  await visible(modal.getByText("Завершена", { exact: true }));
  await modal.getByRole("button", { name: "Закрыть", exact: true }).click();
  await button("Неделя").click();
  await visible(page.locator(".timeline").nth(6));
  await button("День").click();
  await visible(card);
  await page.getByRole("link", { name: "Статистика" }).click();
  await visible(page.getByRole("heading", { name: "Выручка по мастерам" }));
  await width("Статистика 360", 360);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const closeToast = page.getByRole("button", { name: "Закрыть уведомление" });
  while (await closeToast.count()) await closeToast.first().click();
  await page.screenshot({ path: resolve(output, "stats-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: "Услуги" }).click();
  await button("Добавить услугу").click();
  await page.getByLabel("Название услуги").fill("Укладка Браузер");
  await button("Сохранить услугу").click();
  await visible(page.locator(".manager-row").getByText("Укладка Браузер"));
  await page.getByRole("link", { name: "Мастера" }).click();
  await button("Редактировать: " + master.name).click();
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  const dayName = weekday[0].toUpperCase() + weekday.slice(1);
  const checkbox = page.getByLabel(dayName, { exact: true });
  assert.ok(await checkbox.isChecked());
  await checkbox.uncheck();
  await button("Сохранить мастера").click();
  await visible(page.getByText("Данные мастера обновлены"));
  const currentSlots = await (await context.request.get(base + slotPath(date))).json();
  assert.deepEqual(currentSlots, []);
  const response = await context.request.post(base + "/api/booking", { data: {
    date, startTime: slot, masterId: master.id, serviceId: service.id, clientName: "Другой Клиент", clientPhone: "+79991234599",
  } });
  assert.equal(response.status(), 409);
  assert.equal((await response.json()).message, "Это время только что заняли, выберите другое");

  await page.getByRole("link", { name: "Календарь", exact: true }).click();
  if (await page.getByLabel("Дата календаря").inputValue() !== date) await page.getByLabel("Дата календаря").fill(date);
  await visible(card);
  await button("Экспорт CSV").click();
  const [csv] = await Promise.all([page.waitForEvent("download"), button("Скачать CSV").click()]);
  const bytes = await readFile(await csv.path());
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  assert.match(bytes.toString(), /"Клиент";"Телефон";"Статус"[\s\S]*Иван Браузеров/);
  await csv.saveAs(resolve(output, "browser-export.csv"));
  await card.click();
  page.once("dialog", dialog => dialog.accept());
  await button("Удалить запись").click();
  await card.waitFor({ state: "hidden" });
  await button("Отменить").click();
  await visible(card);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Название бизнеса").fill("Учебная студия");
  await page.getByLabel("Сфера услуг").selectOption("tutor");
  await page.getByLabel("Адрес или формат визита").fill("Онлайн");
  await button("Сохранить настройки").click();
  await visible(page.getByText("Настройки сохранены", { exact: true }));
  await page.getByRole("link", { name: "Страница записи", exact: true }).click();
  await visible(page.getByText("Учебная студия · Обучение", { exact: true }));
  await page.locator(".client-service").first().click();
  await visible(page.getByLabel("Преподаватель", { exact: true }));
  assert.equal(await page.locator(".client-location").getByText("Онлайн", { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log("Браузерный сценарий пройден, .ics и CSV скачаны. Проверены 360×840 и 1440×1000.");
} finally {
  await browser?.close();
  server.kill();
}
