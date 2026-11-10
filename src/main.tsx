import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Widget } from "./widget/Widget";
import { AlertWindow } from "./alert/AlertWindow";
import { AgendaWindow } from "./agenda/AgendaWindow";
import "./styles/global.css";
import { initGlass } from "./shared/lib/glass";
import { applyTheme, followTheme, readTheme } from "./shared/lib/theme";
import { followLang, syncLangToRust } from "./shared/i18n";
import { catchUnhandled } from "./shared/lib/log";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// одна страница на четыре окна: главное, виджет (?window=widget), заметное напоминание
// (?window=alert) и список дел у значка в трее (?window=agenda)
const kind = new URLSearchParams(window.location.search).get("window");
const isWidget = kind === "widget";
const isAlert = kind === "alert";
const isAgenda = kind === "agenda";
document.documentElement.dataset.window = isWidget ? "widget" : isAlert ? "alert" : isAgenda ? "agenda" : "main";

// необработанные ошибки любого окна — в журнал
catchUnhandled();

// тему применяем до первой отрисовки, чтобы не мигало
applyTheme(readTheme());
followTheme();
initGlass();
// язык сменили в другом окне — перезагружаемся; главное окно сообщает язык Rust (меню трея)
followLang();
if (!isWidget && !isAlert && !isAgenda) void syncLangToRust();

const Window = isWidget ? Widget : isAlert ? AlertWindow : isAgenda ? AgendaWindow : App;

// только в npm run dev: ?crash=1 ломает отрисовку окна, чтобы автотесты видели экран ошибки
const Crash = () => {
  throw new Error("test crash (?crash=1)");
};
const Root = import.meta.env.DEV && new URLSearchParams(window.location.search).has("crash") ? Crash : Window;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary compact={isWidget || isAlert || isAgenda}>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
