import { formatDayNumber } from "../shared/lib/date";
import { useUnit } from "effector-react";
import { t } from "../shared/i18n";
import { useState, type FormEvent } from "react";
import {
  $authError,
  $needsClient,
  $signingIn,
  $status,
  clientEditCancelled,
  clientEditRequested,
  clientSubmitted,
  saveClientFx,
  signInClicked,
} from "../model/auth";
import { Button } from "./Button";
import s from "./AuthScreen.module.css";

const ClientForm = () => {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, saving, error, submit, cancel] = useUnit([
    $status,
    saveClientFx.pending,
    $authError,
    clientSubmitted,
    clientEditCancelled,
  ]);
  const isJson = clientId.trim().startsWith("{");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ clientId, clientSecret });
  };

  return (
    <form className={s.card} onSubmit={onSubmit}>
      <h1 className={s.title}>{t.auth.clientTitle}</h1>
      <p className={s.text}>{t.auth.clientText}</p>
      <label className={s.field}>
        <span>{t.auth.clientIdLabel}</span>
        <textarea
          rows={isJson ? 6 : 2}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="1234567890-abc.apps.googleusercontent.com"
          spellCheck={false}
          autoFocus
        />
      </label>
      {!isJson && (
        <label className={s.field}>
          <span>{t.auth.clientSecretLabel}</span>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      {error && <p className={s.error}>{error}</p>}
      <div className={s.actions}>
        {status?.clientSource === "file" && (
          <Button variant="ghost" onClick={cancel}>
            {t.common.cancel}
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={saving || !clientId.trim()}>
          {t.common.save}
        </Button>
      </div>
    </form>
  );
};

const SignIn = () => {
  const [status, signingIn, error, signIn, editClient] = useUnit([
    $status,
    $signingIn,
    $authError,
    signInClicked,
    clientEditRequested,
  ]);
  return (
    <div className={s.card}>
      <div className={s.logo} aria-hidden>
        <span>{formatDayNumber(new Date())}</span>
      </div>
      <h1 className={s.title}>Calm Calendar</h1>
      <p className={s.text}>{t.auth.tagline}</p>
      {error && <p className={s.error}>{error}</p>}
      <Button variant="primary" className={s.wide} onClick={() => signIn()} disabled={signingIn}>
        {signingIn ? t.auth.finishInBrowser : t.auth.signIn}
      </Button>
      {signingIn && (
        <p className={s.hint}>{t.auth.tabHint}</p>
      )}
      {status?.clientSource === "file" && !signingIn && (
        <button type="button" className={s.link} onClick={() => editClient()}>
          {t.auth.changeClient}
        </button>
      )}
    </div>
  );
};

export const AuthScreen = () => {
  const [status, needsClient] = useUnit([$status, $needsClient]);
  if (!status) return null;
  return <div className={s.screen}>{needsClient ? <ClientForm /> : <SignIn />}</div>;
};
