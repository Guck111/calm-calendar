import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import type { AppError, AuthStatus } from "./types";
import { inTauri } from "./bus";
import { clearCache } from "./cache";
import { logWarn } from "../lib/log";

export const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" && e !== null && "kind" in e && "message" in e;

export const toAppError = (e: unknown): AppError =>
  isAppError(e) ? e : { kind: "other", message: e instanceof Error ? e.message : String(e) };

/** Текст ошибки на языке интерфейса. Rust присылает вид ошибки и технические подробности по-английски */
const localize = (e: AppError): AppError => {
  const text: Partial<Record<AppError["kind"], string>> = {
    not_configured: t.errors.notConfigured,
    not_signed_in: t.errors.notSignedIn,
    denied: t.errors.denied,
    timeout: t.errors.timeout,
    missing_scope: t.errors.missingScope,
    network: t.errors.network,
  };
  // ошибка Google приходит как «403: Rate limit exceeded»
  const google = e.kind === "google" ? /^(\d{3}): (.*)$/s.exec(e.message) : null;
  return {
    ...e,
    message: text[e.kind] ?? (google ? `${t.errors.google(Number(google[1]))}. ${google[2]}` : e.message),
    // код ответа нужен, чтобы отличить временный сбой Google (503) от отказа (403)
    ...(google ? { status: Number(google[1]) } : {}),
  };
};


// Сборка для автотестов приложения (VITE_CALM_MOCK=1, npm run build:e2e): вход и запросы к Google идут
// в подставные данные, всё остальное (окна, трей, напоминания) — в настоящий Rust. В обычную сборку не попадает
const MOCK_IN_APP = import.meta.env.VITE_CALM_MOCK === "1";
const MOCKED = new Set(["auth_status", "sign_in", "sign_out", "save_client_config", "google_request"]);

// в браузере без Tauri (npm run dev) работаем на подставных данных
const run = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (MOCK_IN_APP ? !MOCKED.has(cmd) : inTauri || !import.meta.env.DEV) return invoke<T>(cmd, args);
  const { mockInvoke } = await import("./mock");
  return (await mockInvoke(cmd, args)) as T;
};

// invoke отклоняется объектом { kind, message } из Rust; приводим всё к AppError
/** запросы к Google и вход Rust записывает в журнал сам */
const LOGGED_IN_RUST = new Set(["google_request", "sign_in"]);

const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await run<T>(cmd, args);
  } catch (e) {
    const error = toAppError(e);
    // истёкший вход — не сбой: интерфейс сам предложит войти снова
    if (!LOGGED_IN_RUST.has(cmd) && error.kind !== "not_signed_in") logWarn(`command ${cmd} failed`, error);
    throw localize(error);
  }
};

type RawAuthStatus = {
  client_source: AuthStatus["clientSource"];
  accounts: { email: string; signed_in: boolean }[];
};

export const getAuthStatus = async (): Promise<AuthStatus> => {
  const raw = await call<RawAuthStatus>("auth_status");
  return {
    clientSource: raw.client_source,
    accounts: raw.accounts.map((a) => ({ email: a.email, signedIn: a.signed_in })),
  };
};

export const saveClientConfig = (clientId: string, clientSecret: string): Promise<void> =>
  call("save_client_config", { clientId, clientSecret });

/** Вход в ещё один аккаунт: Google даёт выбрать какой. Возвращает его email */
export const signIn = (): Promise<string> => call<string>("sign_in");

/** Выход из одного аккаунта, без account — из всех. Сохранённые ответы при этом стираем */
export const signOut = (account?: string): Promise<void> =>
  call<void>("sign_out", account ? { account } : {}).finally(clearCache);

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export const googleRequest = <T>(
  account: string,
  method: HttpMethod,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<T> =>
  call<T>("google_request", {
    account,
    method,
    path,
    query: query ? Object.entries(query) : undefined,
    body,
  });
