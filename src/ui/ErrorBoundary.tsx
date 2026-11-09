import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../shared/i18n";
import { logError, openLogsFolder } from "../shared/lib/log";
import { inTauri } from "../shared/api/bus";
import s from "./ErrorBoundary.module.css";

type Props = { children: ReactNode; compact?: boolean };
type State = { failed: boolean };

/** Ошибка при отрисовке окна: вместо белого экрана — короткое объяснение и «Перезапустить окно».
 *  Данные в Google от этого не страдают: всё, что сохранено, уже там */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(`render failed${info.componentStack ? ` in${info.componentStack.split("\n").slice(0, 6).join("\n")}` : ""}`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.compact ? `${s.crash} ${s.compact}` : s.crash} role="alert">
        <h2>{t.errors.crashTitle}</h2>
        {!this.props.compact && <p>{t.errors.crashText}</p>}
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={() => window.location.reload()}>
            {t.errors.reload}
          </button>
          {inTauri && !this.props.compact && (
            <button type="button" onClick={() => void openLogsFolder()}>
              {t.settings.openLogs}
            </button>
          )}
        </div>
      </div>
    );
  }
}
