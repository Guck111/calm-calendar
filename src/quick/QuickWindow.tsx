// Quick add window: opens with a system-wide Windows hotkey (Ctrl+Alt+Space)
// on top of any windows. The input is the same as in the sidebar and the widget; data is the widget's model.
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
    // on every show — a fresh calendar list and the cursor in the input
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

  // on first open calendars are still loading: without them the input would answer "no calendar"
  const ready = signedIn && (calendars.length > 0 || calendarsTried);

  // the input appears when calendars are loaded: that's when we put the cursor in it
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
