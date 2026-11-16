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

// one page for six windows: main, widget (?window=widget), prominent reminder
// (?window=alert), agenda at the tray icon (?window=agenda) and quick add by
// hotkey (?window=quick), settings (?window=settings)
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

// unhandled errors of any window go to the log
catchUnhandled();

// apply theme, style and fonts before the first render to avoid flicker
applyTheme(readTheme());
followTheme();
applyAppearance(readAppearance());
followAppearance();
initGlass();
// language changed in another window — reload; the main window tells Rust the language (tray menu)
followLang();
if (!isSmall) void syncLangToRust();

const Window = isWidget ? Widget : isAlert ? AlertWindow : isAgenda ? AgendaWindow : isQuick ? QuickWindow : isSettings ? SettingsWindow : App;

// only in npm run dev: ?crash=1 breaks window rendering so autotests can see the error screen
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
