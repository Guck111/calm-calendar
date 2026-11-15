import { useUnit } from "effector-react";
import { signInCancelClicked, signInReopenClicked } from "../model/auth";
import { t } from "../shared/i18n";
import s from "./SignInActions.module.css";

/** Пока ждём браузер со входом: вкладка могла потеряться или человек передумал — без выхода он ждал бы 5 минут */
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
