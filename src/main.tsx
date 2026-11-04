import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";

const isWidget = new URLSearchParams(window.location.search).get("window") === "widget";
document.documentElement.dataset.window = isWidget ? "widget" : "main";

const root = createRoot(document.getElementById("root") as HTMLElement);

// у виджета своя лёгкая модель: модели главного окна в нём не загружаются
const load = isWidget
  ? import("./widget/Widget").then((m) => m.Widget)
  : import("./app/App").then((m) => m.App);

void load.then((Root) =>
  root.render(
    <StrictMode>
      <Root />
    </StrictMode>,
  ),
);
