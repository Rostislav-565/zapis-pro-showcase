import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, LogIn } from "lucide-react";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/cyrillic-700.css";
import "@fontsource/inter/cyrillic-800.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "./style.css";
import "./client.css";
import { Brand, Empty, Skeleton, Theme, Toast } from "./common.tsx";
import { Confirmation, Footer } from "./booking.tsx";
import { Admin } from "./admin.tsx";
import { ClientBooking } from "./client.tsx";
import { message, request } from "./api.ts";
import type { Notify } from "./api.ts";
import type { Catalog } from "../shared/types.ts";

let noticeSequence = 0;
function App() {
  const [light, setLight] = useState(() => localStorage.getItem("zapis-theme") === "light");
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [notices, setNotices] = useState<{ id: number; text: string; kind: "success" | "error"; undo?: () => void }[]>([]);
  const [route, setRoute] = useState(location.pathname);
  const path = route.split("/").filter(Boolean);
  const admin = path[0] === "admin";
  useEffect(() => {
    if (catalog) document.title = (admin ? "Панель управления" : "Онлайн-запись") + " · " + catalog.settings.name;
  }, [admin, catalog]);
  const token = path[0] === "confirmation" || path[0] === "cancel" ? path[1] : undefined;

  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("zapis-theme", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f3f6f8" : "#0b0f14");
  }, [light]);
  useEffect(() => {
    const controller = new AbortController();
    void request<Catalog>("catalog", "GET", undefined, controller.signal).then(setCatalog)
      .catch(problem => { if (!controller.signal.aborted) setError(message(problem)); });
    return () => controller.abort();
  }, [retry]);
  const dismiss = (id: number) => setNotices(items => items.filter(item => item.id !== id));
  const notify: Notify = (text, kind = "success", undo) => {
    const id = ++noticeSequence;
    setNotices(items => [...items, { id, text, kind, undo }]);
    setTimeout(() => dismiss(id), 5000);
  };
  const toggle = () => setLight(value => !value);
  useEffect(() => {
    const navigateBack = () => setRoute(location.pathname);
    window.addEventListener("popstate", navigateBack);
    return () => window.removeEventListener("popstate", navigateBack);
  }, []);
  function confirmBooking(key: string) {
    const next = "/confirmation/" + key;
    history.pushState(null, "", next);
    setRoute(next);
    window.scrollTo(0, 0);
  }

  return <>
    <header className={"topbar" + (admin ? "" : " client-topbar")}><div className="shell topbar-inner">
      <Brand name={catalog?.settings.name} />
      <nav className="top-actions" aria-label="Главное меню">
        <Theme light={light} toggle={toggle} />
        {admin ? <a className="button secondary admin-link" href="/"><CalendarDays size={16} /><span>Страница записи</span></a>
          : <a className="staff-link" href="/admin"><LogIn size={16} /><span>Вход для сотрудников</span></a>}
      </nav>
    </div></header>
    <main className={"shell page " + (admin ? "admin-page" : "client-page")}>
      {admin ? <Admin notify={notify} /> : token ? <Confirmation token={token} cancellation={path[0] === "cancel"} notify={notify} /> :
        error ? <Empty action="Повторить" onClick={() => { setError(""); setRetry(value => value + 1); }}>{error}</Empty> :
          !catalog ? <Skeleton count={5} /> : <ClientBooking data={catalog} notify={notify} done={confirmBooking} />}
    </main>
    <Footer business={catalog?.settings} />
    <Toast notices={notices} dismiss={dismiss} />
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
