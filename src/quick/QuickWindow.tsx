// Окно быстрого создания: открывается сочетанием клавиш на всю Windows (Ctrl+Alt+Space)
// поверх любых окон. Строка та же, что в боковой панели и виджете; данные — модель виджета.
import { useUnit } from "effector-react";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { broadcast, inTauri, openMain, subscribe } from "../shared/api/bus";
import { saveEvent } from "../shared/api/calendar";
import { t } from "../shared/i18n";
import { QuickAdd, type QuickAddHandle } from "../ui/QuickAdd";
import { $calendars, $signedIn, $status, $calendarsTried, refreshRequested, widgetStarted } from "../widget/model";
import s from "./Quick.module.css";

const hide = () => {
  if (inTauri) void invoke("hide_quick");
};

export const QuickWindow = () => {
  const [start, refresh] = useUnit([widgetStarted, refreshRequested]);
  const [status, signedIn, calendars, calendarsTried] = useUnit([$status, $signedIn, $calendars, $calendarsTried]);
  const quick = useRef<QuickAddHandle>(null);
  const writable = calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");

  useEffect(() => {
    start();
    // при каждом показе — свежий список календарей и курсор в строке
    const off = subscribe("quick-shown", () => {
      refresh();
      quick.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
  }, [start, refresh]);

  // при первом открытии календари ещё грузятся: без них строка ответила бы «нет календаря»
  const ready = signedIn && (calendars.length > 0 || calendarsTried);

  // строка появляется, когда календари загружены: тогда и ставим в неё курсор
  useEffect(() => {
    if (ready) quick.current?.focus();
  }, [ready]);

  return (
    <div className={s.panel}>
      {!status ? null : !signedIn ? (
        <p className={s.note}>{t.widget.signInHint}</p>
      ) : !ready ? (
        <p className={s.note}>{t.common.loading}</p>
      ) : (
        <QuickAdd
          ref={quick}
          variant="popup"
          calendars={writable}
          onCreate={async (draft) => {
            await saveEvent(draft);
            broadcast("events-changed", { from: "quick" });
            hide();
          }}
          onExpand={(draft) => {
            openMain(draft.startDate);
            broadcast("open-draft", draft);
            hide();
          }}
        />
      )}
    </div>
  );
};
