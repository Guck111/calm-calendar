import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Widget } from "./widget/Widget";
import "./styles/global.css";
import { initGlass } from "./shared/lib/glass";
import { applyTheme, followTheme, readTheme } from "./shared/lib/theme";
import { followLang, syncLangToRust } from "./shared/i18n";

// одна страница на два окна: главное и виджет (?window=widget)
const isWidget = new URLSearchParams(window.location.search).get("window") === "widget";
document.documentElement.dataset.window = isWidget ? "widget" : "main";

// тему применяем до первой отрисовки, чтобы не мигало
applyTheme(readTheme());
followTheme();
initGlass();
// язык сменили в другом окне — перезагружаемся; главное окно сообщает язык Rust (меню трея)
followLang();
if (!isWidget) void syncLangToRust();

const Root = isWidget ? Widget : App;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
