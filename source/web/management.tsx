import { useEffect, useState } from "react";
import { Ban, Pencil, Plus, Trash2 } from "lucide-react";
import { displayDate, money, phoneMask, weekNames, weekOrder } from "../shared/time.ts";
import { businessTypes } from "../shared/business.ts";
import type { AdminData, Business, ManagedMaster, Service, WorkDay } from "../shared/types.ts";
import { fieldsFrom, message, periodQuery, request, RequestError } from "./api.ts";
import type { Notify } from "./api.ts";
import { Empty, Field, Modal, Skeleton } from "./common.tsx";

const titles: Record<string, [string, string]> = {
  services: ["Услуги", "Управляйте ценами, длительностью и видимостью на витрине"],
  masters: ["Мастера", "Специалисты, услуги и рабочие смены"],
  blocks: ["Блокировки", "Закрывайте даты для всех мастеров или выбранного специалиста"],
  settings: ["Настройки", "Контакты бизнеса и параметры онлайн-записи"],
};
const defaultDay = (): WorkDay => ({ start: "09:00", end: "19:00", breaks: [] });
function useSave(notify: Notify) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save(fn: () => Promise<unknown>, success: string, done: () => void) {
    setErrors({}); setBusy(true);
    try { await fn(); notify(success); done(); }
    catch (problem) { setErrors(fieldsFrom(problem)); notify(message(problem), "error"); }
    finally { setBusy(false); }
  }
  return { errors, busy, save };
}

export function Management({ section, today, notify, expired }: { section: string; today: string; notify: Notify; expired: () => void }) {
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [edit, setEdit] = useState<string>();
  const [removing, setRemoving] = useState("");
  const reload = () => setVersion(value => value + 1);
  const title = titles[section];
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<AdminData>("admin/data?" + periodQuery(today, today), "GET", undefined, controller.signal).then(setData).catch(problem => {
      if (controller.signal.aborted) return;
      if (problem instanceof RequestError && problem.status === 401) expired();
      else setError(message(problem));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, version]);
  if (!title) return <Empty action="К календарю" onClick={() => location.assign("/admin")}>Раздел не найден</Empty>;
  if (error) return <Empty action="Повторить" onClick={reload}>{error}</Empty>;
  if (!data) return <Skeleton />;
  const [heading, intro] = title;
  const addLabel = section === "services" ? "Добавить услугу" : section === "masters" ? "Добавить мастера" : "Заблокировать дату";
  const close = () => setEdit(undefined);
  const done = () => { close(); reload(); };
  async function remove(id: string, prompt: string, success: string) {
    if (!window.confirm(prompt)) return;
    setRemoving(id);
    try {
      await request("admin/" + section + "/" + id, "DELETE");
      setData(previous => previous && {
        ...previous, services: previous.services.filter(item => section !== "services" || item.id !== id),
        masters: previous.masters.filter(item => section !== "masters" || item.id !== id),
        blocks: previous.blocks.filter(item => section !== "blocks" || item.id !== id),
      });
      notify(success, "success", () => {
        void request("admin/" + section + "/" + id + "/undo", "POST").then(() => {
          notify("Удаление отменено"); reload();
        }).catch(problem => notify(message(problem), "error"));
      });
      reload();
    } catch (problem) { notify(message(problem), "error"); }
    finally { setRemoving(""); }
  }
  function rowActions(id: string, name: string, success: string) {
    return <div className="actions">
      {section !== "blocks" && <button className="icon-button" onClick={() => setEdit(id)} aria-label={"Редактировать: " + name} title="Редактировать"><Pencil size={17} /></button>}
      <button className="icon-button destructive" disabled={removing === id} onClick={() => void remove(id,
        section === "blocks" ? "Снять блокировку даты?" : "Удалить «" + name + "»?", success)}
        aria-label={(section === "blocks" ? "Снять блокировку: " : "Удалить: ") + name} title={section === "blocks" ? "Снять блокировку" : "Удалить"}><Trash2 size={17} /></button>
    </div>;
  }
  return <section className="admin-section">
    <div className="section-head"><div><h2>{heading}</h2><p>{intro}</p></div>
      {section !== "settings" && <button className="button primary" onClick={() => setEdit("new")}><Plus size={18} />{addLabel}</button>}</div>
    {section === "services" && (data.services.length ? <div className="panel manager-list">{data.services.map(item => <div key={item.id} className="manager-row">
      <span className="color-dot" style={{ backgroundColor: item.color }} /><div className="manager-label"><strong>{item.name}</strong><small>{item.durationMin} мин · {money(item.price)}</small></div>
      <span className={"badge " + (item.active ? "DONE" : "CANCELLED")}>{item.active ? "На витрине" : "Скрыта"}</span>
      {rowActions(item.id, item.name, "Услуга удалена")}
    </div>)}</div> : <Empty action={addLabel} onClick={() => setEdit("new")}>Услуг пока нет</Empty>)}
    {section === "masters" && (data.masters.length ? <div className="panel manager-list">{data.masters.map(item => <div key={item.id} className="manager-row">
      <div className="manager-label"><strong>{item.name}</strong><small>{phoneMask(item.phone)} · {item.rotationFrom ? "2/2" : "По дням недели"}</small></div>
      <span className={"badge " + (item.active ? "DONE" : "CANCELLED")}>{item.active ? "Активен" : "Скрыт"}</span>
      {rowActions(item.id, item.name, "Мастер удалён")}
    </div>)}</div> : <Empty action={addLabel} onClick={() => setEdit("new")}>Мастеров пока нет</Empty>)}
    {section === "blocks" && (data.blocks.length ? <div className="panel manager-list">{data.blocks.map(item => <div key={item.id} className="manager-row">
      <Ban size={18} className="destructive" /><div className="manager-label"><strong>{displayDate(item.date, { day: "numeric", month: "long", year: "numeric" })}</strong>
        <small>{item.masterId ? data.masters.find(master => master.id === item.masterId)?.name ?? "Удалённый мастер" : "Все мастера"}</small></div>
      {rowActions(item.id, item.date, "Блокировка снята")}
    </div>)}</div> : <Empty action={addLabel} onClick={() => setEdit("new")}>Заблокированных дат нет</Empty>)}
    {section === "settings" && <div className="panel settings-panel"><SettingsForm business={data.settings} notify={notify} done={reload} /></div>}
    {edit && <Modal title={edit === "new" ? addLabel : section === "services" ? "Редактировать услугу" : "Редактировать мастера"} close={close}>
      {section === "services" && <ServiceForm item={data.services.find(item => item.id === edit)} notify={notify} done={done} />}
      {section === "masters" && <MasterForm item={data.masters.find(item => item.id === edit)} services={data.services} today={today} notify={notify} done={done} />}
      {section === "blocks" && <BlockForm masters={data.masters} today={today} notify={notify} done={done} />}
    </Modal>}
  </section>;
}

function ServiceForm({ item, notify, done }: { item?: Service; notify: Notify; done: () => void }) {
  const [state, setState] = useState(item ?? { name: "", description: "", durationMin: 30, price: 1000, color: "#22c55e", active: true });
  const { errors, busy, save } = useSave(notify);
  return <form className="form" noValidate onSubmit={event => {
    event.preventDefault();
    void save(() => request("admin/services" + (item ? "/" + item.id : ""), item ? "PUT" : "POST", state), item ? "Услуга обновлена" : "Услуга создана", done);
  }}>
    <Field label="Название услуги" error={errors.name}><input value={state.name} onChange={event => setState({ ...state, name: event.target.value })} /></Field>
    <Field label="Описание для клиента" error={errors.description}><textarea value={state.description} rows={2} maxLength={240}
      onChange={event => setState({ ...state, description: event.target.value })} /></Field>
    <div className="form-grid"><Field label="Длительность, мин" error={errors.durationMin}><input type="number" value={state.durationMin}
      onChange={event => setState({ ...state, durationMin: Number(event.target.value) })} /></Field>
      <Field label="Цена, ₽" error={errors.price}><input type="number" value={state.price} onChange={event => setState({ ...state, price: Number(event.target.value) })} /></Field></div>
    <Field label="Цвет в календаре" error={errors.color}><input type="color" value={state.color} onChange={event => setState({ ...state, color: event.target.value })} /></Field>
    <label className="checkbox"><input type="checkbox" checked={state.active} onChange={event => setState({ ...state, active: event.target.checked })} />Показывать на витрине</label>
    <button className="button primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить услугу"}</button>
  </form>;
}

function MasterForm({ item, services, today, notify, done }: {
  item?: ManagedMaster; services: Service[]; today: string; notify: Notify; done: () => void;
}) {
  const [state, setState] = useState<Omit<ManagedMaster, "id">>(item ? {
    ...item, phone: phoneMask(item.phone), serviceIds: item.serviceIds.filter(id => services.some(service => service.id === id)),
  } : { name: "", phone: "", active: true, serviceIds: [], workSchedule: {}, rotationFrom: null });
  const { errors, busy, save } = useSave(notify);
  const keys = state.rotationFrom ? ["rotation"] : weekOrder.map(String);
  const setDay = (key: string, day: WorkDay | null) => setState(previous => ({ ...previous, workSchedule: { ...previous.workSchedule, [key]: day } }));
  return <form className="form" noValidate onSubmit={event => {
    event.preventDefault();
    void save(() => request("admin/masters" + (item ? "/" + item.id : ""), item ? "PUT" : "POST", state), item ? "Данные мастера обновлены" : "Мастер создан", done);
  }}>
    <div className="form-grid">
      <Field label="Имя мастера" error={errors.name}><input value={state.name} onChange={event => setState({ ...state, name: event.target.value })} /></Field>
      <Field label="Телефон мастера" error={errors.phone}><input type="tel" placeholder="+7 (___) ___-__-__" value={state.phone}
        onChange={event => setState({ ...state, phone: phoneMask(event.target.value) })} /></Field>
    </div>
    <label className="checkbox"><input type="checkbox" checked={state.active} onChange={event => setState({ ...state, active: event.target.checked })} />Доступен для записи</label>
    <fieldset className="editor-group"><legend>Услуги мастера</legend>{services.length ? services.map(service =>
      <label className="checkbox" key={service.id}><input type="checkbox" checked={state.serviceIds.includes(service.id)} onChange={event => setState({
        ...state, serviceIds: event.target.checked ? [...state.serviceIds, service.id] : state.serviceIds.filter(id => id !== service.id),
      })} />{service.name}</label>) : <p>Сначала добавьте услуги в панели.</p>}{errors.serviceIds && <p className="field-error">{errors.serviceIds}</p>}</fieldset>
    <fieldset className="editor-group"><legend>Рабочий график</legend>
      <Field label="Тип графика"><select value={state.rotationFrom ? "rotation" : "week"} onChange={event => {
        const rotate = event.target.value === "rotation";
        setState({ ...state, rotationFrom: rotate ? today : null, workSchedule: {
          ...state.workSchedule, ...(rotate && !state.workSchedule.rotation ? { rotation: defaultDay() } : {}),
        } });
      }}><option value="week">По дням недели</option><option value="rotation">2/2</option></select></Field>
      {state.rotationFrom && <Field label="Первый день цикла 2/2" error={errors.rotationFrom}><input type="date" value={state.rotationFrom}
        onChange={event => { if (event.target.value) setState({ ...state, rotationFrom: event.target.value }); }} /></Field>}
      {keys.map(key => {
        const day = state.workSchedule[key];
        const name = key === "rotation" ? "Рабочая смена" : weekNames[Number(key)];
        const prefix = "workSchedule." + key;
        return <div className="shift-row" key={key}>
          {key !== "rotation" ? <label className="checkbox"><input type="checkbox" checked={!!day}
            onChange={event => setDay(key, event.target.checked ? defaultDay() : null)} />{name}</label> : <strong>{name}</strong>}
          {errors[prefix] && <p className="field-error">{errors[prefix]}</p>}
          {day && <>
            <div className="form-grid">
              <Field label="Начало смены" error={errors[prefix + ".start"]}><input type="time" value={day.start} onChange={event => setDay(key, { ...day, start: event.target.value })} /></Field>
              <Field label="Конец смены" error={errors[prefix + ".end"]}><input type="time" value={day.end} onChange={event => setDay(key, { ...day, end: event.target.value })} /></Field>
            </div>
            {day.breaks.map((pause, index) => <div className="break-row" key={index}>
              <Field label="Начало перерыва" error={errors[prefix + ".breaks." + index + ".start"]}><input type="time" value={pause.start}
                onChange={event => setDay(key, { ...day, breaks: day.breaks.map((part, at) => at === index ? { ...part, start: event.target.value } : part) })} /></Field>
              <Field label="Конец перерыва" error={errors[prefix + ".breaks." + index + ".end"]}><input type="time" value={pause.end}
                onChange={event => setDay(key, { ...day, breaks: day.breaks.map((part, at) => at === index ? { ...part, end: event.target.value } : part) })} /></Field>
              <button type="button" className="icon-button destructive" aria-label="Удалить перерыв" onClick={() => setDay(key, { ...day,
                breaks: day.breaks.filter((_, at) => at !== index),
              })}><Trash2 size={16} /></button>
              {errors[prefix + ".breaks." + index] && <small className="field-error">{errors[prefix + ".breaks." + index]}</small>}
            </div>)}
            <button className="text-button" type="button" disabled={day.breaks.length >= 12} onClick={() => setDay(key, {
              ...day, breaks: [...day.breaks, { start: "13:00", end: "13:30" }],
            })}><Plus size={15} /> Добавить перерыв</button>
          </>}
        </div>;
      })}
    </fieldset>
    <button className="button primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить мастера"}</button>
  </form>;
}

function BlockForm({ masters, today, notify, done }: { masters: ManagedMaster[]; today: string; notify: Notify; done: () => void }) {
  const [date, setDate] = useState(today);
  const [masterId, setMaster] = useState("");
  const { errors, busy, save } = useSave(notify);
  return <form className="form" noValidate onSubmit={event => {
    event.preventDefault(); void save(() => request("admin/blocks", "POST", { date, masterId: masterId || null }), "Дата заблокирована", done);
  }}>
    <Field label="Дата" error={errors.date}><input type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
    <Field label="Мастер" error={errors.masterId}><select value={masterId} onChange={event => setMaster(event.target.value)}>
      <option value="">Все мастера</option>{masters.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select></Field>
    <button className="button primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Заблокировать дату"}</button>
  </form>;
}
function SettingsForm({ business, notify, done }: { business: Business; notify: Notify; done: () => void }) {
  const [state, setState] = useState({ ...business, phone: phoneMask(business.phone) });
  const { errors, busy, save } = useSave(notify);
  return <form className="form" noValidate onSubmit={event => {
    event.preventDefault(); void save(() => request("admin/settings", "PUT", state), "Настройки сохранены", done);
  }}>
    <Field label="Название бизнеса" error={errors.name}><input value={state.name} onChange={event => setState({ ...state, name: event.target.value })} /></Field>
    <Field label="Сфера услуг" error={errors.businessType}><select value={state.businessType} onChange={event => {
      const value = Object.keys(businessTypes).find(key => key === event.target.value) as Business["businessType"] | undefined;
      if (value) setState({ ...state, businessType: value });
    }}>{Object.entries(businessTypes).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}</select></Field>
    <p className="client-secondary">Сфера задаёт подписи на странице записи. Услуги и графики редактируются в своих разделах.</p>
    <Field label="Адрес или формат визита" error={errors.address}><input value={state.address} onChange={event => setState({ ...state, address: event.target.value })} /></Field>
    <Field label="Телефон" error={errors.phone}><input type="tel" value={state.phone} onChange={event => setState({ ...state, phone: phoneMask(event.target.value) })} /></Field>
    <div className="form-grid">
      <Field label="Шаг сетки, мин" error={errors.gridStep}><input type="number" value={state.gridStep} onChange={event => setState({ ...state, gridStep: Number(event.target.value) })} /></Field>
      <Field label="Горизонт записи, дней" error={errors.bookingDays}><input type="number" value={state.bookingDays} onChange={event => setState({ ...state, bookingDays: Number(event.target.value) })} /></Field>
    </div>
    <button className="button primary" disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить настройки"}</button>
  </form>;
}
