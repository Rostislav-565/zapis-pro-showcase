import { useEffect, useState } from "react";
import { Ban, CalendarDays, ChartNoAxesColumn, ChevronLeft, ChevronRight, Clock3, Download, LogOut, Plus, Scissors, Search, Settings, Users } from "lucide-react";
import { addDays, clockTime, dateObject, displayDate, money, phoneMask, toMinutes, workDay } from "../shared/time.ts";
import { statuses } from "../shared/types.ts";
import type { AdminData, Booking, Catalog, Stat, Statistics, Status } from "../shared/types.ts";
import { fieldsFrom, message, periodQuery, request, RequestError } from "./api.ts";
import type { Notify } from "./api.ts";
import { Empty, Field, Modal, Skeleton, mutate, saveDownload } from "./common.tsx";
import { BookingFlow } from "./booking.tsx";
import { Management } from "./management.tsx";

const menu = [
  ["", "Календарь", CalendarDays], ["stats", "Статистика", ChartNoAxesColumn], ["services", "Услуги", Scissors],
  ["masters", "Мастера", Users], ["blocks", "Блокировки", Ban], ["settings", "Настройки", Settings],
] as const;
const transitions: Partial<Record<Status, [Status, string][]>> = {
  NEW: [["CONFIRMED", "Подтвердить"], ["CANCELLED", "Отменить запись"], ["NO_SHOW", "Отметить неявку"]],
  CONFIRMED: [["DONE", "Завершить"], ["CANCELLED", "Отменить запись"], ["NO_SHOW", "Отметить неявку"]],
};

function Login({ notify, complete }: { notify: Notify; complete: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return <section className="login panel">
    <span className="success-icon"><CalendarDays size={26} /></span>
    <h1>Панель управления</h1><p>Войдите, чтобы управлять записями.</p>
    <form className="form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setFields({});
      try {
        await request("admin/login", "POST", { login: username, password });
        notify("Вы вошли в панель управления");
        complete();
      } catch (problem) { setFields(fieldsFrom(problem)); setError(message(problem)); notify(message(problem), "error"); }
      finally { setBusy(false); }
    }}>
      <Field label="Логин" error={fields.login}><input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></Field>
      <Field label="Пароль" error={fields.password}><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></Field>
      {error && !Object.keys(fields).length && <p className="field-error">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
    </form>
  </section>;
}
export function Admin({ notify }: { notify: Notify }) {
  const [today, setToday] = useState<string>();
  const [auth, setAuth] = useState<"checking" | "signed-out" | "signed-in" | "error">("checking");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [active, setActive] = useState(() => location.pathname.split("/")[2] || "");
  useEffect(() => {
    const handler = () => setActive(location.pathname.split("/")[2] || "");
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ today: string | null }>("admin/session", "GET", undefined, controller.signal).then(result => {
      setToday(result.today ?? undefined); setAuth(result.today ? "signed-in" : "signed-out");
    }).catch(problem => {
      if (controller.signal.aborted) return;
      setError(message(problem));
      setAuth(problem instanceof RequestError && problem.status === 401 ? "signed-out" : "error");
    });
    return () => controller.abort();
  }, [refresh]);
  if (auth === "checking") return <Skeleton count={5} />;
  if (auth === "error") return <Empty action="Повторить" onClick={() => { setAuth("checking"); setRefresh(value => value + 1); }}>{error}</Empty>;
  if (auth === "signed-out" || !today) return <Login notify={notify} complete={() => { setAuth("checking"); setRefresh(value => value + 1); }} />;
  const sessionExpired = () => { setAuth("signed-out"); notify("Сеанс завершён. Войдите снова", "error"); };
  return <>
    <div className="admin-header">
      <div><p className="eyebrow">ЗАПИСЬПРО</p><h1>Панель управления</h1></div>
      <button className="button secondary" onClick={() => void mutate(async () => { await request("admin/logout", "POST"); setAuth("signed-out"); },
        notify, "Вы вышли из панели")}><LogOut size={17} /> Выйти</button>
    </div>
    <nav className="admin-nav" aria-label="Разделы панели">{menu.map(([id, label, Icon]) => <a key={id} href={id ? "/admin/" + id : "/admin"} aria-current={active === id ? "page" : undefined}
      onClick={event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); history.pushState(null, "", id ? "/admin/" + id : "/admin"); setActive(id);
      }}><Icon size={17} />{label}</a>)}</nav>
    {active === "stats" ? <Stats today={today} notify={notify} expired={sessionExpired} /> :
      active ? <Management key={active} section={active} today={today} notify={notify} expired={sessionExpired} /> :
        <ScheduleFeed today={today} notify={notify} expired={sessionExpired} />}
  </>;
}

function ScheduleFeed({ today, notify, expired }: { today: string; notify: Notify; expired: () => void }) {
  const [date, setDate] = useState(today);
  const [week, setWeek] = useState(false);
  const [data, setData] = useState<AdminData>();
  const [failure, setFailure] = useState("");
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [manual, setManual] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const from = week ? addDays(date, -((dateObject(date).getUTCDay() + 6) % 7)) : date;
  const to = week ? addDays(from, 6) : date;
  const days = week ? Array.from({ length: 7 }, (_, index) => addDays(from, index)) : [date];
  const refresh = () => setVersion(value => value + 1);
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim().toLocaleLowerCase("ru")), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setFailure("");
    void request<AdminData>("admin/data?" + periodQuery(from, to), "GET", undefined, controller.signal).then(setData).catch(problem => {
      if (controller.signal.aborted) return;
      if (problem instanceof RequestError && problem.status === 401) expired();
      else setFailure(message(problem));
    });
    return () => controller.abort();
    // The session callback changes when the parent renders a toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, version]);
  const booking = data?.bookings.find(item => item.id === selected);

  async function updateStatus(item: Booking, status: Status, label: string) {
    setBusy(true);
    setData(previous => previous && ({ ...previous, bookings: previous.bookings.map(record => record.id === item.id ? { ...record, status } : record) }));
    try {
      await request("admin/bookings/" + item.id, "PATCH", { status });
      notify("Статус обновлён: " + label);
    } catch (problem) {
      setData(previous => previous && ({ ...previous, bookings: previous.bookings.map(record => record.id === item.id ? { ...record, status: item.status } : record) }));
      notify(message(problem), "error");
    } finally { setBusy(false); }
  }

  async function remove(item: Booking) {
    if (!window.confirm("Удалить запись клиента «" + item.clientName + "»?")) return;
    setBusy(true);
    try {
      await request("admin/bookings/" + item.id, "DELETE");
      setSelected("");
      setData(previous => previous && ({ ...previous, bookings: previous.bookings.filter(record => record.id !== item.id) }));
      notify("Запись удалена", "success", () => void mutate(async () => {
        await request("admin/bookings/" + item.id + "/undo", "POST"); refresh();
      }, notify, "Запись восстановлена"));
    } catch (problem) { notify(message(problem), "error"); }
    finally { setBusy(false); }
  }

  const records = data?.bookings.filter(item => !query || [item.clientName, item.clientPhone, item.service.name, item.master.name].some(
    value => value.toLocaleLowerCase("ru").includes(query)) || (/\d/.test(query) && item.clientPhone.includes(query.replace(/\D/g, "")))) ?? [];
  const catalog: Catalog | undefined = data && { settings: data.settings, today, services: data.services.filter(item => item.active), masters: data.masters.filter(item => item.active) };

  return <section className="admin-section">
    <div className="section-head"><div><h2>Календарь записей</h2><p>Расписание и визиты по мастерам</p></div>
      <div className="actions"><button className="button secondary" onClick={() => setExporting(true)}><Download size={17} /> Экспорт CSV</button>
        <button className="button primary" onClick={() => setManual(true)} disabled={!data}><Plus size={18} /> Новая запись</button></div></div>
    <div className="toolbar panel">
      <div className="calendar-controls">
        <button className="icon-button" aria-label="Предыдущий период" onClick={() => { setData(undefined); setDate(addDays(date, week ? -7 : -1)); }}><ChevronLeft size={19} /></button>
        <label className="date-filter"><span className="sr-only">Дата календаря</span><input type="date" value={date} onChange={event => {
          if (event.target.value && event.target.value !== date) { if (!week || event.target.value < from || event.target.value > to) setData(undefined); setDate(event.target.value); }
        }} /></label>
        <button className="icon-button" aria-label="Следующий период" onClick={() => { setData(undefined); setDate(addDays(date, week ? 7 : 1)); }}><ChevronRight size={19} /></button>
        <button className="button secondary today-button" onClick={() => { if (today < from || today > to) setData(undefined); setDate(today); }}>Сегодня</button>
      </div>
      <div className="toolbar-right">
        <label className="search"><Search size={17} /><input aria-label="Поиск записей" placeholder="Имя или телефон" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="segmented" aria-label="Вид календаря"><button aria-pressed={!week} onClick={() => { if (week) { setData(undefined); setWeek(false); } }}>День</button>
          <button aria-pressed={week} onClick={() => { if (!week) { setData(undefined); setWeek(true); } }}>Неделя</button></div>
      </div>
    </div>
    {failure ? <Empty action="Повторить" onClick={refresh}>{failure}</Empty> : !data ? <Skeleton count={4} /> : <>
      {query && !records.length && <Empty action="Очистить поиск" onClick={() => { setSearch(""); setQuery(""); }}>Записей по этому запросу нет</Empty>}
      {!query && !records.length && <Empty action="Новая запись" onClick={() => setManual(true)}>На этот период пока нет записей</Empty>}
      {days.map(day => <Timeline key={day} day={day} records={records.filter(item => item.date === day)} data={data} open={setSelected} />)}
    </>}
    {manual && catalog && <Modal title="Новая запись" close={() => setManual(false)}><BookingFlow data={catalog} initialDate={date} notify={notify} done={(id, _token, day) => {
      setManual(false); setSelected(id); if (day < from || day > to) setDate(day); refresh();
    }} /></Modal>}
    {exporting && <Modal title="Экспорт записей" close={() => setExporting(false)}>
      <Period initialFrom={from} initialTo={to} label="Скачать CSV" apply={async (start, end) => {
        await saveDownload("admin/export?" + periodQuery(start, end), "zapis-pro.csv"); notify("CSV скачан"); setExporting(false);
      }} notify={notify} />
    </Modal>}
    {booking && <Modal title={booking.clientName} close={() => setSelected("")}>
      <span className={"badge " + booking.status}>{statuses[booking.status]}</span>
      <dl className="confirm-details">
        <div><dt>Услуга</dt><dd>{booking.service.name}</dd></div><div><dt>Мастер</dt><dd>{booking.master.name}</dd></div>
        <div><dt>Дата и время</dt><dd>{displayDate(booking.date, { day: "numeric", month: "long" })}, {booking.startTime}–{booking.endTime}</dd></div>
        <div><dt>Телефон</dt><dd><a href={"tel:" + booking.clientPhone}>{phoneMask(booking.clientPhone)}</a></dd></div>
        <div><dt>Стоимость</dt><dd>{money(booking.price)}</dd></div>
        {booking.comment && <div><dt>Комментарий</dt><dd>{booking.comment}</dd></div>}
      </dl>
      <div className="actions">{transitions[booking.status]?.map(([status, label], index) => <button key={status}
        type="button" className={"button " + (index === 0 ? "primary" : "secondary")} disabled={busy} onClick={() => void updateStatus(booking, status, statuses[status])}>{label}</button>)}
        <button className="button danger" disabled={busy} onClick={() => void remove(booking)}>Удалить запись</button>
      </div>
    </Modal>}
  </section>;
}

function Timeline({ day, records, data, open }: { day: string; records: Booking[]; data: AdminData; open: (id: string) => void }) {
  const people = new Map(data.masters.filter(item => item.active || records.some(record => record.masterId === item.id)).map(item => [item.id, item.name]));
  for (const record of records) people.set(record.masterId, record.master.name);
  const schedules = new Map(data.masters.map(item => {
    const off = data.blocks.some(block => block.date === day && (!block.masterId || block.masterId === item.id));
    return [item.id, { off, shift: off ? null : workDay(item.workSchedule, day, item.rotationFrom) }] as const;
  }));
  const shifts = [...schedules.values()].flatMap(item => item.shift ? [item.shift] : []);
  const start = Math.floor(Math.min(9 * 60, ...shifts.map(item => toMinutes(item.start)), ...records.map(item => toMinutes(item.startTime))) / 60);
  const end = Math.ceil(Math.max(20 * 60, ...shifts.map(item => toMinutes(item.end)), ...records.map(item => toMinutes(item.endTime))) / 60);
  const scale = 1.42;
  const position = (time: string) => (toMinutes(time) - start * 60) * scale;
  return <article className="timeline panel">
    <h3>{displayDate(day, { weekday: "long", day: "numeric", month: "long" })} <span>{records.length} зап.</span></h3>
    {people.size ? <div className="timeline-scroll">
      <div className="timeline-grid" style={{ gridTemplateColumns: "60px repeat(" + people.size + ", minmax(165px, 1fr))" }}>
        <div className="timeline-header"><Clock3 size={16} /></div>
        {[...people].map(([id, name]) => <div className="timeline-header" key={id}>
          <strong>{name}</strong><small>{schedules.get(id)?.off ? "Дата заблокирована" : schedules.get(id)?.shift ? schedules.get(id)?.shift?.start + "–" + schedules.get(id)?.shift?.end : "Выходной"}</small>
        </div>)}
        <div className="timeline-times" style={{ height: (end - start) * 60 * scale }}>
          {Array.from({ length: end - start }, (_, index) => <span key={index} style={{ top: index * 60 * scale }}>{clockTime((start + index) * 60)}</span>)}
        </div>
        {[...people].map(([id]) => {
          const items = records.filter(item => item.masterId === id);
          return <div className={"timeline-column " + (!schedules.get(id)?.shift ? "off" : "")} key={id}
            style={{ backgroundSize: "100% " + 60 * scale + "px" }}>
            {items.map(item => {
              const cancelled = item.status === "CANCELLED";
              const indented = items.some(other => other.id !== item.id && other.status !== "CANCELLED" && other.startTime < item.endTime && other.endTime > item.startTime);
              return <button type="button" key={item.id} className={"appointment " + (cancelled ? "cancelled" : "") + (indented ? " split" : "")}
                onClick={() => open(item.id)} style={{ top: position(item.startTime), height: Math.max(28, position(item.endTime) - position(item.startTime) - 3),
                  borderLeftColor: item.service.color, backgroundColor: "color-mix(in srgb, " + item.service.color + " 17%, var(--surface))" }}>
                <span><time>{item.startTime}</time> <strong>{item.clientName}</strong></span>
                {toMinutes(item.endTime) - toMinutes(item.startTime) >= 30 && <span className={"badge " + item.status}>{statuses[item.status]}</span>}
              </button>;
            })}
          </div>;
        })}
      </div>
    </div> : <Empty>Добавьте мастеров в разделе «Мастера»</Empty>}
  </article>;
}

function Period({ initialFrom, initialTo, label, apply, notify }: {
  initialFrom: string; initialTo: string; label: string; apply: (from: string, to: string) => Promise<void>; notify: Notify;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return <form className="period" noValidate onSubmit={async event => {
    event.preventDefault(); setErrors({});
    if (!from || !to || to < from || to > addDays(from, 365)) { setErrors({ to: "Укажите корректный период до 366 дней" }); return; }
    setBusy(true);
    try { await apply(from, to); }
    catch (problem) { setErrors(fieldsFrom(problem)); notify(message(problem), "error"); }
    finally { setBusy(false); }
  }}>
    <Field label="С" error={errors.from}><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
    <Field label="По" error={errors.to}><input type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
    <button className="button primary" disabled={busy} type="submit">{busy ? "Загрузка…" : label}</button>
  </form>;
}

function Bars({ label, items }: { label: string; items: Stat[] }) {
  const max = Math.max(1, ...items.map(item => item.revenue));
  return <section className="panel chart"><h3>{label}</h3>
    {!items.length ? <Empty>Данных за период нет</Empty> : <ul className="bars">{items.map((item, index) => <li key={index}>
      <span>{item.name}</span><div className="bar-track" aria-hidden><i style={{ width: item.revenue / max * 100 + "%" }} /></div><strong>{money(item.revenue)}</strong>
    </li>)}</ul>}
  </section>;
}
function Stats({ today, notify, expired }: { today: string; notify: Notify; expired: () => void }) {
  const [data, setData] = useState<Statistics>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const end = addDays(today, 6);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<Statistics>("admin/stats?" + periodQuery(today, end), "GET", undefined, controller.signal).then(setData).catch(problem => {
      if (controller.signal.aborted) return;
      if (problem instanceof RequestError && problem.status === 401) expired();
      else setError(message(problem));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, end, retry]);
  return <section className="admin-section">
    <div className="section-head"><div><h2>Статистика</h2><p>Выручка, загрузка мастеров и неявки</p></div></div>
    <div className="panel period-wrap"><Period initialFrom={today} initialTo={end} label="Показать" notify={notify} apply={async (from, to) => {
      setData(await request<Statistics>("admin/stats?" + periodQuery(from, to))); setError("");
    }} /></div>
    {error ? <Empty action="Повторить" onClick={() => setRetry(value => value + 1)}>{error}</Empty> : !data ? <Skeleton /> : <>
      <div className="kpis"><div className="panel"><span>Выручка</span><strong>{money(data.revenue)}</strong></div>
        <div className="panel"><span>Завершённые визиты</span><strong>{data.completed}</strong></div>
        <div className="panel"><span>Неявки</span><strong>{data.noShows}</strong></div></div>
      <div className="chart-grid"><Bars label="Выручка по дням" items={data.days} /><Bars label="Выручка по мастерам" items={data.masters} />
        <Bars label="Выручка по услугам" items={data.services} /><section className="panel chart"><h3>Загрузка мастеров</h3>
          {!data.masters.length ? <Empty>Нет мастеров за этот период</Empty> : <ul className="bars">{data.masters.map((item, index) =>
            <li key={index}><span>{item.name}</span><div className="bar-track" aria-hidden><i style={{ width: item.utilization + "%" }} /></div><strong>{item.utilization}%</strong></li>)}</ul>}
        </section></div>
    </>}
  </section>;
}
