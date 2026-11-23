import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CircleAlert, CircleCheck, Moon, Sun, X } from "lucide-react";
import type { Notify } from "./api.ts";
import { message } from "./api.ts";

export function Brand({ name = "Барбершоп Бритва" }: { name?: string }) {
  return <a href="/" className="brand"><span className="brand-icon"><CalendarDays size={20} aria-hidden /></span><span>{name}</span></a>;
}
export function Theme({ light, toggle }: { light: boolean; toggle: () => void }) {
  return <button className="icon-button" type="button" onClick={toggle} aria-label={light ? "Тёмная тема" : "Светлая тема"} title={light ? "Тёмная тема" : "Светлая тема"}>
    {light ? <Moon size={19} /> : <Sun size={19} />}
  </button>;
}
export function Field({ label, error, children }: { label: string; error?: string; children: ReactElement<{ "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }> }) {
  const id = useId();
  return <div className="field">
    <label><span id={id + "-label"}>{label}</span>{cloneElement(children, { "aria-labelledby": id + "-label", "aria-describedby": error ? id : undefined, "aria-invalid": !!error })}</label>
    {error && <small id={id} className="field-error">{error}</small>}
  </div>;
}
export function Empty({ children, action, onClick }: { children: ReactNode; action?: string; onClick?: () => void }) {
  return <div className="empty"><p>{children}</p>{action && <button type="button" className="button secondary" onClick={onClick}>{action}</button>}</div>;
}
export function Skeleton({ count = 3 }: { count?: number }) {
  return <div className="skeleton-group" role="status" aria-label="Загрузка">{Array.from({ length: count }, (_, index) => <div className="skeleton" key={index} />)}</div>;
}
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = element.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={element} className="dialog" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="Закрыть"><X size={19} /></button></div>
    {children}
  </dialog>;
}
export function Toast({ notices, dismiss }: { notices: { id: number; text: string; kind: "success" | "error"; undo?: () => void }[]; dismiss: (id: number) => void }) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const update = () => setDialog(document.querySelector<HTMLDialogElement>("dialog[open]"));
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    update();
    return () => observer.disconnect();
  }, []);
  const view = <div className="toasts" aria-live="polite">{notices.map(info => <div key={info.id} className={"toast " + info.kind}>
    {info.kind === "error" ? <CircleAlert size={20} /> : <CircleCheck size={20} />}
    <span>{info.text}</span>{info.undo && <button type="button" className="text-button" onClick={() => { dismiss(info.id); info.undo?.(); }}>Отменить</button>}
    <button type="button" className="icon-button" onClick={() => dismiss(info.id)} aria-label="Закрыть уведомление"><X size={17} /></button>
  </div>)}</div>;
  return dialog ? createPortal(view, dialog) : view;
}
export async function mutate(action: () => Promise<unknown>, notify: Notify, success: string) {
  try { await action(); notify(success); }
  catch (error) { notify(message(error), "error"); }
}
export async function saveDownload(path: string, fallback: string) {
  let response: Response;
  try { response = await fetch("/api/" + path); }
  catch { throw new Error("Не удалось связаться с сервером"); }
  if (!response.ok) throw new Error((await response.json()).message);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
