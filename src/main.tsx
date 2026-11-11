import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Widget } from "./widget/Widget";
import { AlertWindow } from "./alert/AlertWindow";
import { AgendaWindow } from "./agenda/AgendaWindow";
import { QuickWindow } from "./quick/QuickWindow";
import { SettingsWindow } from "./settings/SettingsWindow";
import "./styles/fonts.css";
import "./styles/global.css";
import "./styles/styles.css";
import { initGlass } from "./shared/lib/glass";
import { applyTheme, followTheme, readTheme } from "./shared/lib/theme";
import { applyAppearance, followAppearance, readAppearance } from "./shared/lib/appearance";
import { followLang, syncLangToRust } from "./shared/i18n";
import { catchUnhandled } from "./shared/lib/log";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// одна страница на шесть окон: главное, виджет (?window=widget), заметное напоминание
// (?window=alert), список дел у значка в трее (?window=agenda) и быстрое создание по
// сочетанию клавиш (?window=quick), настройки (?window=settings)
const kind = new URLSearchParams(window.location.search).get("window");
const isWidget = kind === "widget";
const isAlert = kind === "alert";
const isAgenda = kind === "agenda";
const isQuick = kind === "quick";
const isSettings = kind === "settings";
const isSmall = isWidget || isAlert || isAgenda || isQuick || isSettings;
document.documentElement.dataset.window = isWidget
  ? "widget"
  : isAlert
    ? "alert"
    : isAgenda
      ? "agenda"
      : isQuick
        ? "quick"
        : isSettings
          ? "settings"
          : "main";

// необработанные ошибки любого окна — в журнал
catchUnhandled();

// тему, стиль и шрифты применяем до первой отрисовки, чтобы не мигало
applyTheme(readTheme());
followTheme();
applyAppearance(readAppearance());
followAppearance();
initGlass();
// язык сменили в другом окне — перезагружаемся; главное окно сообщает язык Rust (меню трея)
followLang();
if (!isSmall) void syncLangToRust();

const Window = isWidget ? Widget : isAlert ? AlertWindow : isAgenda ? AgendaWindow : isQuick ? QuickWindow : isSettings ? SettingsWindow : App;

// только в npm run dev: ?crash=1 ломает отрисовку окна, чтобы автотесты видели экран ошибки
const Crash = () => {
  throw new Error("test crash (?crash=1)");
};
const Root = import.meta.env.DEV && new URLSearchParams(window.location.search).has("crash") ? Crash : Window;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary compact={isSmall}>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
