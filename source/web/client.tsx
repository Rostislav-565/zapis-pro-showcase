import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, MapPin, Phone, Search } from "lucide-react";
import { businessTypes } from "../shared/business.ts";
import { displayDate, money, normalizedPhone, phoneMask } from "../shared/time.ts";
import type { Availability, Catalog, SlotChoice } from "../shared/types.ts";
import { fieldsFrom, message, request, RequestError } from "./api.ts";
import type { Notify } from "./api.ts";
import { Empty, Field, Skeleton } from "./common.tsx";

const daysPerPage = 7;
const formatDate = (date: string) => displayDate(date, { day: "numeric", month: "long", weekday: "short" });

export function ClientBooking({ data, notify, done }: { data: Catalog; notify: Notify; done: (token: string) => void }) {
  const { settings } = data;
  const vocabulary = businessTypes[settings.businessType];
  const dateSection = useRef<HTMLElement>(null);
  const contactSection = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [editingService, setEditingService] = useState(false);
  const [serviceId, setService] = useState("");
  const [masterId, setMaster] = useState("");
  const [date, setDate] = useState("");
  const preferredDate = useRef("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SlotChoice>();
  const [availability, setAvailability] = useState<Availability>();
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const service = data.services.find(item => item.id === serviceId);
  const specialists = data.masters.filter(item => item.serviceIds.includes(serviceId));
  const chosenSpecialist = data.masters.find(item => item.id === selected?.masterId || (!selected && item.id === masterId));
  const days = availability?.slice(page * daysPerPage, (page + 1) * daysPerPage) ?? [];
  const slots = availability?.find(day => day.date === date)?.slots ?? [];
  const firstDay = availability?.find(day => day.slots.length);
  const foundServices = service && !editingService ? [service] : data.services.filter(item => (item.name + " " + item.description).toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")));

  useEffect(() => {
    if (!serviceId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ serviceId });
    if (masterId) query.set("masterId", masterId);
    void request<Availability>("availability?" + query, "GET", undefined, controller.signal).then(result => {
      setAvailability(result);
      const preferred = result.findIndex(day => day.date === preferredDate.current && day.slots.length);
      const first = preferred < 0 ? result.findIndex(day => day.slots.length) : preferred;
      setDate(first < 0 ? "" : result[first].date);
      setPage(first < 0 ? 0 : Math.floor(first / daysPerPage));
    }).catch(problem => { if (!controller.signal.aborted) setFailure(message(problem)); });
    return () => controller.abort();
  }, [serviceId, masterId, retry]);

  function chooseDate(value: string) {
    preferredDate.current = value;
    setDate(value);
  }

  function resetAvailability() {
    setAvailability(undefined);
    setFailure("");
    setSelected(undefined);
  }

  function moveTo(section: HTMLElement | null) {
    requestAnimationFrame(() => {
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ block: "nearest" });
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const fields: Record<string, string> = {};
    if (name.trim().length < 2) fields.clientName = "Введите имя, минимум 2 символа";
    if (!normalizedPhone(phone)) fields.clientPhone = "Укажите телефон в формате +7 (999) 123-45-67";
    setErrors(fields);
    if (Object.keys(fields).length) return;
    setBusy(true);
    try {
      const result = await request<{ token: string }>("booking", "POST", {
        serviceId, masterId: selected.masterId, date, startTime: selected.time, clientName: name, clientPhone: phone, comment,
      });
      notify("Запись создана");
      done(result.token);
    } catch (problem) {
      setErrors(fieldsFrom(problem));
      notify(message(problem), "error");
      if (problem instanceof RequestError && problem.status === 409) {
        resetAvailability();
        setRetry(value => value + 1);
        moveTo(dateSection.current);
      }
    } finally { setBusy(false); }
  }

  return <div className="client-layout">
    <header className="client-intro">
      <p>{settings.name}{!settings.name.toLocaleLowerCase("ru").includes(vocabulary.name.toLocaleLowerCase("ru")) && settings.businessType !== "other" && <> <span aria-hidden>·</span> {vocabulary.name}</>}</p>
      <h1>Онлайн-запись</h1>
      <p>Выберите услугу и свободное время для визита.</p>
    </header>
    <div className="client-form">
      <section className="client-section" aria-labelledby="client-services">
        <div className="client-section-head"><h2 id="client-services">{service && !editingService ? "Услуга" : "Выберите услугу"}</h2>
          {service && !editingService && <button type="button" className="text-button" disabled={busy} onClick={() => { setSearch(""); setEditingService(true); }}>Изменить услугу</button>}
        </div>
        {(!service || editingService) && data.services.length > 7 && <label className="search client-search"><Search size={18} />
          <input aria-label="Найти услугу" placeholder="Найти услугу" value={search} onChange={event => setSearch(event.target.value)} />
        </label>}
        {foundServices.length ? <div className="client-services">{foundServices.map(item => {
          const isSelected = item.id === serviceId;
          return <button type="button" className="client-service" aria-pressed={isSelected} key={item.id} disabled={busy}
            onClick={() => {
              if (!isSelected) { preferredDate.current = ""; resetAvailability(); setService(item.id); setMaster(""); }
              setEditingService(false);
              moveTo(dateSection.current);
            }}>
            <span className="client-service-name"><strong>{item.name}</strong>
              <small>{item.durationMin} мин{item.description && <> <span aria-hidden>·</span> {item.description}</>}</small></span>
            <span className="client-price">{money(item.price)}</span>
            <span className="client-pick" aria-hidden>{isSelected ? <Check size={16} /> : <span />}</span>
          </button>;
        })}</div> : search ? <Empty action="Очистить поиск" onClick={() => setSearch("")}>Совпадений нет</Empty> : <Empty>Онлайн-запись сейчас недоступна. Свяжитесь с нами по телефону.</Empty>}
      </section>

      <section className="client-section client-date" aria-labelledby="client-date" ref={dateSection} tabIndex={-1}>
        <h2 id="client-date">Дата и время</h2>
        {!service ? <p className="client-secondary">Сначала выберите услугу в списке выше.</p> : !specialists.length ?
          <p className="client-secondary">У этой услуги пока нет доступных специалистов. Выберите другую услугу или позвоните нам.</p> : <>
          {specialists.length > 1 && <Field label={vocabulary.specialist}>
            <select value={masterId} disabled={busy} onChange={event => { resetAvailability(); setMaster(event.target.value); }}>
              <option value="">{vocabulary.anyone}</option>
              {specialists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>}
          {failure ? <Empty action="Повторить" onClick={() => { resetAvailability(); setRetry(value => value + 1); }}>{failure}</Empty>
            : !availability ? <Skeleton count={2} /> : !firstDay ? <Empty>На доступные для записи даты свободного времени нет.</Empty> : <>
              <div className="client-date-toolbar">
                <span>{formatDate(days[0].date)} — {formatDate(days[days.length - 1].date)}</span>
                <div className="actions">
                  <button className="icon-button" type="button" aria-label="Предыдущие дни" disabled={page === 0 || busy} onClick={() => {
                    setPage(page - 1);
                    chooseDate(availability.slice((page - 1) * daysPerPage, page * daysPerPage).find(day => day.slots.length)?.date ?? "");
                    setSelected(undefined);
                  }}><ChevronLeft size={18} /></button>
                  <button className="icon-button" type="button" aria-label="Следующие дни" disabled={(page + 1) * daysPerPage >= availability.length || busy} onClick={() => {
                    setPage(page + 1);
                    chooseDate(availability.slice((page + 1) * daysPerPage, (page + 2) * daysPerPage).find(day => day.slots.length)?.date ?? "");
                    setSelected(undefined);
                  }}><ChevronRight size={18} /></button>
                </div>
              </div>
              <div className="days client-days" aria-label="Дни записи">{days.map(day => <button type="button"
                aria-label={formatDate(day.date) + (day.slots.length ? "" : ", нет свободного времени")}
                aria-pressed={day.date === date} disabled={!day.slots.length || busy} key={day.date} onClick={() => {
                  if (day.date !== date) { chooseDate(day.date); setSelected(undefined); }
                }}>
                <small>{day.date === data.today ? "Сегодня" : displayDate(day.date, { weekday: "short" })}</small>
                <b>{displayDate(day.date, { day: "numeric" })}</b>
              </button>)}</div>
              {slots.length ? <div className="slots client-slots" aria-label="Свободное время">{slots.map(slot => <button type="button"
                className="slot" key={slot.time} aria-pressed={selected?.time === slot.time} disabled={busy}
                onClick={() => { setSelected(slot); requestAnimationFrame(() => moveTo(contactSection.current)); }}>{slot.time}</button>)}</div> :
                <Empty action="К ближайшему свободному дню" onClick={() => {
                  setPage(Math.floor(availability.indexOf(firstDay) / daysPerPage)); chooseDate(firstDay.date); setSelected(undefined);
                }}>На этой неделе нет свободного времени</Empty>}
            </>}
        </>}
      </section>

      {selected && <section className="client-section client-contact" aria-labelledby="client-contacts" ref={contactSection} tabIndex={-1}>
        <h2 id="client-contacts">Ваши контакты</h2>
        <p className="client-secondary">{formatDate(date)}, {selected.time}{chosenSpecialist && " · " + chosenSpecialist.name}</p>
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <Field label="Имя" error={errors.clientName}><input autoComplete="name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></Field>
            <Field label="Телефон" error={errors.clientPhone}><input type="tel" autoComplete="tel" value={phone} placeholder="+7 (___) ___-__-__"
              onChange={event => setPhone(phoneMask(event.target.value))} /></Field>
          </div>
          <details open={errors.comment ? true : undefined}>
            <summary>Добавить комментарий</summary>
            <Field label="Комментарий (необязательно)" error={errors.comment}><textarea value={comment} maxLength={500} rows={2}
              onChange={event => setComment(event.target.value)} /></Field>
          </details>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Подтвердить запись"}</button>
        </form>
      </section>}
    </div>

    <aside className="client-sidebar">
      {service && <section className="client-aside-card" aria-label="Ваша запись">
        <h2>Ваша запись</h2>
        <strong>{service.name}</strong>
        <p>{service.durationMin} мин · {money(service.price)}</p>
        {selected && <p><CalendarDays size={16} /> {formatDate(date)} в {selected.time}</p>}
        {chosenSpecialist && <p>{vocabulary.specialist} — {chosenSpecialist.name}</p>}
      </section>}
      <section className="client-aside-card client-location">
        <h2>Место и контакты</h2>
        {settings.businessType === "barber" || settings.businessType === "auto" ?
          <a href={"https://maps.google.com/?q=" + encodeURIComponent(settings.address)} target="_blank" rel="noreferrer">
            <MapPin size={17} /><span>{settings.address}</span></a> :
          <p><MapPin size={17} /><span>{settings.address}</span></p>}
        <a href={"tel:" + settings.phone}><Phone size={17} /> {phoneMask(settings.phone)}</a>
      </section>
    </aside>
  </div>;
}
