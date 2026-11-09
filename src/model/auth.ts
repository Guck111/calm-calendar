import { createEffect, createEvent, createStore, sample } from "effector";
import * as bridge from "../shared/api/bridge";
import { broadcast } from "../shared/api/bus";
import type { Account, AppError, AuthStatus } from "../shared/api/types";

export const appStarted = createEvent();
/** любой запрос к Google сообщил, что вход больше недействителен */
export const sessionLost = createEvent();
/** вход в Google: первый аккаунт, ещё один или повторный в аккаунт, где вход истёк */
export const signInClicked = createEvent();
/** выход из одного аккаунта; без email — из всех */
export const signOutClicked = createEvent<string | void>();
export const clientSubmitted = createEvent<{ clientId: string; clientSecret: string }>();
export const clientEditRequested = createEvent();
export const clientEditCancelled = createEvent();

export const fetchStatusFx = createEffect(bridge.getAuthStatus);
export const signInFx = createEffect<void, string, AppError>(() => bridge.signIn());
export const signOutFx = createEffect<string | void, void, AppError>((account) => bridge.signOut(account || undefined));
export const saveClientFx = createEffect<{ clientId: string; clientSecret: string }, void, AppError>(
  ({ clientId, clientSecret }) => bridge.saveClientConfig(clientId, clientSecret),
);

export const $status = createStore<AuthStatus | null>(null).on(fetchStatusFx.doneData, (_, s) => s);

/** все добавленные аккаунты, включая те, где вход истёк */
export const $accounts = $status.map((s): Account[] => (s?.clientSource === "none" ? [] : (s?.accounts ?? [])));

/** аккаунты с действующим входом — из них и читаем календари */
export const $activeAccounts = $accounts.map((list) => list.filter((a) => a.signedIn).map((a) => a.email));

// без клиента OAuth токен не обновить, поэтому вход без клиента не считается действующим
export const $signedIn = $activeAccounts.map((list) => list.length > 0);

export const $editingClient = createStore(false)
  .on(clientEditRequested, () => true)
  .on([clientEditCancelled, saveClientFx.done], () => false);

export const $needsClient = sample({
  source: { status: $status, editing: $editingClient },
  fn: ({ status, editing }) => editing || status?.clientSource === "none",
});

export const $authError = createStore<string | null>(null)
  .on([signInFx.failData, saveClientFx.failData], (_, e) => e.message)
  .reset([signInFx, saveClientFx, clientEditRequested, clientEditCancelled]);

export const $signingIn = signInFx.pending;

sample({ clock: [appStarted, sessionLost], target: fetchStatusFx });
sample({ clock: signInClicked, filter: signInFx.pending.map((p) => !p), target: signInFx });
sample({ clock: signOutClicked, target: signOutFx });
sample({ clock: clientSubmitted, target: saveClientFx });
sample({
  clock: [signInFx.finally, signOutFx.finally, saveClientFx.done],
  target: fetchStatusFx,
});

// виджет и список у трея живут в отдельных окнах и узнают о входе и выходе отсюда
signInFx.done.watch(() => broadcast("auth-changed"));
signOutFx.finally.watch(() => broadcast("auth-changed"));
