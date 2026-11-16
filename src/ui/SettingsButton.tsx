// Gear in the toolbar. In the app settings open in a separate window
// (it can be dragged outside the calendar), in the browser — in a window on top of the page.
import { useState } from "react";
import { useUnit } from "effector-react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../shared/api/bus";
import { t } from "../shared/i18n";
import { reloadRequested } from "../model/events";
import { Button } from "./Button";
import { Gear } from "./icons";
import { SettingsDialog } from "./Settings";

export const SettingsButton = () => {
  const [open, setOpen] = useState(false);
  const reload = useUnit(reloadRequested);
  const onClick = () => (inTauri ? void invoke("open_settings") : setOpen(true));
  return (
    <>
      <Button variant="ghost" icon onClick={onClick} title={t.common.settings} aria-label={t.common.settings}>
        <Gear />
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} onReschedule={reload} />}
    </>
  );
};
