import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Widget } from "./widget/Widget";
import { AlertWindow } from "./alert/AlertWindow";
import "./styles/global.css";
import { initGlass } from "./shared/lib/glass";
import { applyTheme, followTheme, readTheme } from "./shared/lib/theme";
import { followLang, syncLangToRust } from "./shared/i18n";

// одна страница на три окна: главное, виджет (?window=widget) и заметное напоминание (?window=alert)
const kind = new URLSearchParams(window.location.search).get("window");
const isWidget = kind === "widget";
const isAlert = kind === "alert";
document.documentElement.dataset.window = isWidget ? "widget" : isAlert ? "alert" : "main";

// тему применяем до первой отрисовки, чтобы не мигало
applyTheme(readTheme());
followTheme();
initGlass();
// язык сменили в другом окне — перезагружаемся; главное окно сообщает язык Rust (меню трея)
followLang();
if (!isWidget && !isAlert) void syncLangToRust();

const Root = isWidget ? Widget : isAlert ? AlertWindow : App;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
