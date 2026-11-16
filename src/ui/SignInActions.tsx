import { useUnit } from "effector-react";
import { signInCancelClicked, signInReopenClicked } from "../model/auth";
import { t } from "../shared/i18n";
import s from "./SignInActions.module.css";

/** While waiting for the browser with sign-in: the tab could have got lost or the person changed their mind — without a way out they'd wait 5 minutes */
export const SignInActions = ({ center = false }: { center?: boolean }) => {
  const [reopen, cancel] = useUnit([signInReopenClicked, signInCancelClicked]);
  return (
    <div className={center ? `${s.row} ${s.center}` : s.row}>
      <button type="button" className={s.link} onClick={() => reopen()}>
        {t.auth.reopen}
      </button>
      <button type="button" className={s.link} onClick={() => cancel()}>
        {t.common.cancel}
      </button>
    </div>
  );
};
