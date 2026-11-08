import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import type { AppError, AuthStatus } from "./types";
import { inTauri } from "./bus";

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
  return { ...e, message: text[e.kind] ?? (google ? `${t.errors.google(Number(google[1]))}. ${google[2]}` : e.message) };
};


// в браузере без Tauri (npm run dev) работаем на подставных данных
const run = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (inTauri || !import.meta.env.DEV) return invoke<T>(cmd, args);
  const { mockInvoke } = await import("./mock");
  return (await mockInvoke(cmd, args)) as T;
};

// invoke отклоняется объектом { kind, message } из Rust; приводим всё к AppError
const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await run<T>(cmd, args);
  } catch (e) {
    throw localize(toAppError(e));
  }
};

type RawAuthStatus = { client_source: AuthStatus["clientSource"]; signed_in: boolean; email: string | null };

export const getAuthStatus = async (): Promise<AuthStatus> => {
  const raw = await call<RawAuthStatus>("auth_status");
  return { clientSource: raw.client_source, signedIn: raw.signed_in, email: raw.email };
};

export const saveClientConfig = (clientId: string, clientSecret: string): Promise<void> =>
  call("save_client_config", { clientId, clientSecret });

export const signIn = (): Promise<string | null> => call("sign_in");

export const signOut = (): Promise<void> => call("sign_out");

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export const googleRequest = <T>(
  method: HttpMethod,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<T> =>
  call<T>("google_request", {
    method,
    path,
    query: query ? Object.entries(query) : undefined,
    body,
  });
