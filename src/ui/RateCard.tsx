import { useUnit } from "effector-react";
import { $ratingOpen, rateClicked, rateDeclined } from "../model/rating";
import { t } from "../shared/i18n";
import { Button } from "./Button";
import { Close } from "./icons";
// the same corner card as "What else Calm Calendar can do"
import s from "./Welcome.module.css";

/** "Enjoying Calm Calendar?": once, in the Store build. Does not take the focus or cover the calendar */
export const RateCard = () => {
  const [open, rate, decline] = useUnit([$ratingOpen, rateClicked, rateDeclined]);
  if (!open) return null;
  return (
    <aside className={s.card} aria-labelledby="rating-title">
      <div className={s.head}>
        <h2 id="rating-title" className={s.title}>
          {t.rating.title}
        </h2>
        <Button variant="ghost" icon onClick={() => decline()} aria-label={t.common.close}>
          <Close size={14} />
        </Button>
      </div>
      <p className={s.intro}>{t.rating.text}</p>
      <div className={s.actions}>
        <Button variant="ghost" onClick={() => decline()}>
          {t.rating.later}
        </Button>
        <Button variant="primary" onClick={() => rate()}>
          {t.rating.rate}
        </Button>
      </div>
    </aside>
  );
};
