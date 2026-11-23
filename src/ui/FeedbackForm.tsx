// Settings → Help: a suggestion, a problem or a question as a letter in the user's own mail app
import { useEffect, useState, type FormEvent } from "react";
import { inTauri } from "../shared/api/bus";
import { openExternal } from "../shared/api/open";
import { isStoreBuild } from "../shared/api/store";
import { lang, t } from "../shared/i18n";
import { copyText } from "../shared/lib/clipboard";
import {
  FEEDBACK_KINDS,
  SUPPORT_EMAIL,
  feedbackLetter,
  feedbackMail,
  letterText,
  type FeedbackKind,
} from "../shared/lib/feedback";
import { APP_VERSION } from "../shared/lib/version";
import { Button, cx } from "./Button";
import s from "./Settings.module.css";

const buildName = (store: boolean) => (store ? "Microsoft Store" : inTauri ? "installer" : "browser");

export const FeedbackForm = () => {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [store, setStore] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void isStoreBuild().then(setStore, () => {});
  }, []);

  const letter = () =>
    feedbackLetter(t.settings.feedbackKinds[kind], message, {
      version: APP_VERSION,
      build: buildName(store),
      language: lang,
      system: navigator.userAgent,
    });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const mail = feedbackMail(letter(), t.settings.feedbackPaste);
    // a long text does not fit into the link: it waits on the clipboard
    if (!mail.whole && (await copyText(letter().message))) setNote(t.settings.feedbackLong);
    await openExternal(mail.href);
  };

  const copy = async () => {
    if (await copyText(letterText(letter()))) setNote(t.settings.feedbackCopied(SUPPORT_EMAIL));
  };

  const empty = !message.trim();
  return (
    <form className={s.section} onSubmit={(e) => void send(e)}>
      <h4>{t.settings.feedback}</h4>
      <small className={s.sectionText}>{t.settings.feedbackText}</small>
      <div className={s.segmented} role="radiogroup" aria-label={t.settings.feedback}>
        {FEEDBACK_KINDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={kind === id}
            className={cx(s.segment, kind === id && s.active)}
            onClick={() => setKind(id)}
          >
            {t.settings.feedbackKinds[id]}
          </button>
        ))}
      </div>
      <textarea
        className={s.message}
        rows={6}
        aria-label={t.settings.feedbackMessage}
        placeholder={t.settings.feedbackMessage}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setNote(null);
        }}
      />
      <div className={s.feedbackActions}>
        <Button type="submit" variant="primary" disabled={empty}>
          {t.settings.feedbackSend}
        </Button>
        <Button disabled={empty} onClick={() => void copy()}>
          {t.settings.feedbackCopy}
        </Button>
        <span className={s.supportEmail}>{SUPPORT_EMAIL}</span>
      </div>
      {note && (
        <p className={s.hint} role="status">
          {note}
        </p>
      )}
    </form>
  );
};
