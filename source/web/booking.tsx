import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ClipboardList, Clock3, MailCheck, Scissors, UserRound } from "lucide-react";
import { addDays, displayDate, money, normalizedPhone, phoneMask } from "../shared/time.ts";
import type { Booking, Business, Catalog, Master, Service } from "../shared/types.ts";
import { businessTypes } from "../shared/business.ts";
import { fieldsFrom, message, request, RequestError } from "./api.ts";
import type { Notify } from "./api.ts";
import { Brand, Empty, Field, Skeleton, mutate, saveDownload } from "./common.tsx";

const steps = ["Услуга", "Специалист", "Дата и время", "Контакты"];

export function BookingFlow({ data, notify, initialDate, done }: {
  data: Catalog; notify: Notify; initialDate?: string; done: (id: string, token: string, date: string) => void;
}) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const [serviceId, setService] = useState("");
  const [masterId, setMaster] = useState("");
  const [date, setDate] = useState(initialDate && initialDate >= data.today ? initialDate : data.today);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotState, setSlotState] = useState<"loading" | "ready" | "error">("loading");
  const [slotError, setSlotError] = useState("");
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const service = data.services.find(item => item.id === serviceId);
  const master = data.masters.find(item => item.id === masterId);
  const eligible = data.masters.filter(item => item.serviceIds.includes(serviceId));
  const completedCount = time ? 3 : masterId ? 2 : serviceId ? 1 : 0;
  useEffect(() => {
    if (step !== 2 || !serviceId || !masterId || !date) return;
    const controller = new AbortController();
    setSlotState("loading");
    const params = new URLSearchParams({ serviceId, masterId, date });
    void request<string[]>("admin/slots?" + params, "GET", undefined, controller.signal).then(items => {
      setSlots(items);
      setSlotState("ready");
    }).catch(error => {
      if (controller.signal.aborted) return;
      setSlotError(message(error));
      setSlotState("error");
    });
    return () => controller.abort();
  }, [serviceId, masterId, date, step, retry]);

  useEffect(() => {
    if (step === previousStep.current) return;
    previousStep.current = step;
    const title = heading.current;
    title?.focus({ preventScroll: true });
    const bounds = title?.getBoundingClientRect();
    if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) title?.scrollIntoView({ block: "start" });
  }, [step]);

  function pickService(item: Service) { if (item.id !== serviceId) { setMaster(""); setTime(""); } setService(item.id); setStep(1); }
  function pickMaster(item: Master) { if (item.id !== masterId) { setTime(""); setSlotState("loading"); } setMaster(item.id); setStep(2); }
  function pickDate(day: string) { if (day !== date && day) { setDate(day); setTime(""); setSlotState("loading"); } }
  function goTo(next: number) { if (next === 2) setSlotState("loading"); setStep(next); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (name.trim().length < 2) fields.clientName = "Введите имя, минимум 2 символа";
    if (!normalizedPhone(phone)) fields.clientPhone = "Укажите телефон в формате +7 (999) 123-45-67";
    setErrors(fields);
    if (Object.keys(fields).length) return;
    setBusy(true);
    try {
      const result = await request<{ id: string; token: string }>("admin/bookings", "POST",
        { date, serviceId, masterId, startTime: time, clientName: name, clientPhone: phone, comment });
      notify("Запись создана");
      done(result.id, result.token, date);
    } catch (error) {
      setErrors(fieldsFrom(error));
      notify(message(error), "error");
      if (error instanceof RequestError && error.status === 409) { setTime(""); goTo(2); }
    } finally { setBusy(false); }
  }

  return <div className="booking-flow manual">
    <ol className="steps" aria-label="Шаги записи">
      {steps.map((label, index) => <li key={label}>
        <button type="button" onClick={() => goTo(index)} disabled={index > completedCount || busy}
          className={index === step ? "current" : index < step ? "complete" : ""} aria-current={index === step ? "step" : undefined}>
          <span>{index < step ? <Check size={15} /> : index + 1}</span>{label}
        </button>
      </li>)}
    </ol>
    <div className="booking-layout">
      <section className="stage" aria-labelledby="stage-heading">
        <div className="stage-head"><h2 id="stage-heading" ref={heading} tabIndex={-1}>{["Выберите услугу", "Выберите мастера", "Выберите дату и время", "Ваши контакты"][step]}</h2>
          <p>{["С чего начнём ваш визит?", "Эти мастера выполняют выбранную услугу.", "Показано только свободное время.", "Укажите данные, чтобы забронировать время."][step]}</p></div>
        {step === 0 && (data.services.length ? <div className="service-grid">{data.services.map(item => {
          return <button className={"service-card" + (serviceId === item.id ? " selected" : "")} type="button" onClick={() => pickService(item)} key={item.id}>
            <span className="service-icon"><Scissors size={22} /></span>
            <span className="service-text"><strong>{item.name}</strong>
              {item.description && <small>{item.description}</small>}
              <span className="service-meta"><Clock3 size={14} /> {item.durationMin} мин <i /> <b>{money(item.price)}</b></span>
            </span>
          </button>;
        })}</div> : <Empty action="Обновить" onClick={() => location.reload()}>Услуги пока недоступны</Empty>)}
        {step === 1 && (eligible.length ? <div className="master-grid">{eligible.map(item => <button type="button" className={"master-card" + (item.id === masterId ? " selected" : "")}
          key={item.id} onClick={() => pickMaster(item)}>
          <span className="avatar"><UserRound /></span>
          <strong>{item.name}</strong>
        </button>)}</div> : <Empty action="Выбрать другую услугу" onClick={() => goTo(0)}>На эту услугу пока нет мастеров</Empty>)}
        {step === 2 && <>
          <Field label="Дата"><input type="date" min={data.today} value={date} onChange={event => pickDate(event.target.value)} /></Field>
          <div className="slot-panel">
            <h3>{displayDate(date, { weekday: "long", day: "numeric", month: "long" })}</h3>
            {slotState === "loading" ? <Skeleton count={2} /> : slotState === "error" ?
              <Empty action="Повторить" onClick={() => { setSlotState("loading"); setRetry(value => value + 1); }}>{slotError}</Empty> :
              slots.length ? <div className="slots">{slots.map(slot => <button type="button" key={slot} className="slot" onClick={() => { setTime(slot); setStep(3); }}>{slot}</button>)}</div> :
                <Empty action="Следующий день" onClick={() => pickDate(addDays(date, 1))}>На этот день свободного времени нет</Empty>}
          </div>
        </>}
        {step === 3 && <form className="form" onSubmit={submit} noValidate>
          <Field label="Имя" error={errors.clientName}><input autoComplete="name" value={name} maxLength={80} placeholder="Как к вам обращаться" onChange={event => setName(event.target.value)} /></Field>
          <Field label="Телефон" error={errors.clientPhone}><input type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="+7 (___) ___-__-__" onChange={event => setPhone(phoneMask(event.target.value))} /></Field>
          <Field label="Комментарий (необязательно)" error={errors.comment}><textarea value={comment} maxLength={500} rows={3} placeholder="Пожелания к визиту" onChange={event => setComment(event.target.value)} /></Field>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Создать запись"}</button>
        </form>}
        {step > 0 && <button className="text-button back" type="button" onClick={() => goTo(step - 1)} disabled={busy}>Назад</button>}
      </section>
      <aside className="summary-wrap"><section className="summary">
        <header><span className="summary-icon"><ClipboardList size={20} /></span><h3>Ваша запись</h3></header>
        <div className="summary-details">
          <div><Scissors size={17} /><span>Услуга<strong>{service?.name || "Не выбрана"}</strong></span></div>
          <div><UserRound size={17} /><span>Мастер<strong>{master?.name || "Не выбран"}</strong></span></div>
          <div><CalendarDays size={17} /><span>Дата и время<strong>{time ? displayDate(date, { day: "numeric", month: "long" }) + " в " + time : "Не выбраны"}</strong></span></div>
        </div>
        <div className="summary-total"><span>Итого</span><strong>{service ? money(service.price) : "—"}</strong></div>
      </section>
      </aside>
    </div>
  </div>;
}

export function Confirmation({ token, notify, cancellation }: { token: string; notify: Notify; cancellation: boolean }) {
  const [result, setResult] = useState<{ booking: Booking; settings: Business }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ booking: Booking; settings: Business }>("booking/" + token, "GET", undefined, controller.signal)
      .then(setResult).catch(problem => { if (!controller.signal.aborted) setError(message(problem)); });
    return () => controller.abort();
  }, [token]);
  if (error) return <Empty action="На главную" onClick={() => location.assign("/")}>{error}</Empty>;
  if (!result) return <Skeleton />;
  const { booking, settings } = result;
  const cancelled = booking.status === "CANCELLED";
  return <section className="confirmation panel">
    <span className="success-icon"><MailCheck size={30} /></span>
    <h1>{cancelled ? "Запись отменена" : cancellation ? "Отмена записи" : "Вы записаны!"}</h1>
    <p>{booking.clientName}, {cancelled ? "вы можете выбрать новое время." : cancellation ? "проверьте детали перед отменой." : "будем ждать вас в выбранное время."}</p>
    <dl className="confirm-details">
      <div><dt>Услуга</dt><dd>{booking.service.name}</dd></div><div><dt>{businessTypes[settings.businessType].specialist}</dt><dd>{booking.master.name}</dd></div>
      <div><dt>Дата и время</dt><dd>{displayDate(booking.date, { day: "numeric", month: "long", year: "numeric" })}, {booking.startTime}–{booking.endTime}</dd></div>
      <div><dt>Телефон</dt><dd>{phoneMask(booking.clientPhone)}</dd></div><div><dt>Адрес</dt><dd>{settings.address}</dd></div>
      <div><dt>Стоимость</dt><dd>{money(booking.price)}</dd></div>
      {booking.comment && <div><dt>Комментарий</dt><dd>{booking.comment}</dd></div>}
    </dl>
    <div className="actions">
      {!cancelled && !cancellation && <button className="button primary" type="button" onClick={() => void mutate(
        () => saveDownload("booking/" + token + "/calendar.ics", "zapis-pro.ics"), notify, "Файл календаря скачан")}><CalendarDays size={18} /> Добавить в календарь</button>}
      {!cancelled && cancellation && <button className="button danger" type="button" disabled={busy} onClick={() => {
        setBusy(true);
        void mutate(async () => {
          await request("booking/" + token + "/cancel", "POST");
          setResult({ ...result, booking: { ...booking, status: "CANCELLED" } });
        }, notify, "Запись отменена").finally(() => setBusy(false));
      }}>Отменить запись</button>}
      <a className="button secondary" href="/">На главную</a>
    </div>
    {!cancelled && !cancellation && <div className="confirm-link-note">
      <p>Сохраните ссылку, чтобы позже открыть или отменить запись.</p>
      {navigator.clipboard && <button type="button" className="text-button" onClick={() => void mutate(
        () => navigator.clipboard.writeText(location.href), notify, "Ссылка скопирована")}>Скопировать ссылку</button>}
      <a className="text-button cancel-link" href={"/cancel/" + token}>Отменить запись</a>
    </div>}
  </section>;
}
export function Footer({ business }: { business?: Business }) {
  return <footer className="footer"><div className="shell footer-inner"><Brand name={business?.name} /><span>ЗаписьПро · Онлайн-запись для бизнеса</span></div></footer>;
}
