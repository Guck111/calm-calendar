import { createEffect, createEvent, createStore, sample } from "effector";
import * as bridge from "../shared/api/bridge";
import { broadcast } from "../shared/api/bus";
import type { Account, AppError, AuthStatus } from "../shared/api/types";

export const appStarted = createEvent();
/** some Google request reported that the sign-in is no longer valid */
export const sessionLost = createEvent();
/** Google sign-in: first account, another one, or again into an account whose sign-in expired */
export const signInClicked = createEvent();
/** sign out of one account; without email — of all */
export const signOutClicked = createEvent<string | void>();
export const clientSubmitted = createEvent<{ clientId: string; clientSecret: string }>();
export const clientEditRequested = createEvent();
export const clientEditCancelled = createEvent();

export const fetchStatusFx = createEffect(bridge.getAuthStatus);
export const signInFx = createEffect<void, string, AppError>(() => bridge.signIn());
/** sign-in tab got lost or closed: open the same Google page again */
export const signInReopenClicked = createEvent();
/** changed mind about signing in: Rust stops waiting for the browser, signInFx rejects with kind "cancelled" */
export const signInCancelClicked = createEvent();
export const reopenSignInFx = createEffect<void, void, AppError>(() => bridge.reopenSignIn());
export const cancelSignInFx = createEffect<void, void, AppError>(() => bridge.cancelSignIn());
export const signOutFx = createEffect<string | void, void, AppError>((account) => bridge.signOut(account || undefined));
export const saveClientFx = createEffect<{ clientId: string; clientSecret: string }, void, AppError>(
  ({ clientId, clientSecret }) => bridge.saveClientConfig(clientId, clientSecret),
);

export const $status = createStore<AuthStatus | null>(null).on(fetchStatusFx.doneData, (_, s) => s);

/** all added accounts, including those whose sign-in expired */
export const $accounts = $status.map((s): Account[] => (s?.clientSource === "none" ? [] : (s?.accounts ?? [])));

/** accounts with valid sign-in — calendars are read from them */
export const $activeAccounts = $accounts.map((list) => list.filter((a) => a.signedIn).map((a) => a.email));

// without an OAuth client the token can't be refreshed, so sign-in without a client is not considered valid
export const $signedIn = $activeAccounts.map((list) => list.length > 0);

export const $editingClient = createStore(false)
  .on(clientEditRequested, () => true)
  .on([clientEditCancelled, saveClientFx.done], () => false);

export const $needsClient = sample({
  source: { status: $status, editing: $editingClient },
  fn: ({ status, editing }) => editing || status?.clientSource === "none",
});

export const $authError = createStore<string | null>(null)
  // cancelling sign-in is the person's decision, not an error
  .on(signInFx.failData, (prev, e) => (e.kind === "cancelled" ? prev : e.message))
  .on(saveClientFx.failData, (_, e) => e.message)
  .reset([signInFx, saveClientFx, clientEditRequested, clientEditCancelled]);

export const $signingIn = signInFx.pending;

sample({ clock: [appStarted, sessionLost], target: fetchStatusFx });
sample({ clock: signInClicked, filter: signInFx.pending.map((p) => !p), target: signInFx });
sample({ clock: signInReopenClicked, target: reopenSignInFx });
sample({ clock: signInCancelClicked, target: cancelSignInFx });
/** sign-out is held: a pending deletion must reach Google first (model/undo.ts), otherwise it
 *  would be lost together with the account's sign-in */
export const $signOutHeld = createStore(false);
/** deletion went through — the held sign-out continues */
export const signOutResumed = createEvent<string | void>();
sample({ clock: signOutClicked, filter: $signOutHeld.map((held) => !held), target: signOutFx });
sample({ clock: signOutResumed, target: signOutFx });
sample({ clock: clientSubmitted, target: saveClientFx });
sample({
  clock: [signInFx.finally, signOutFx.finally, saveClientFx.done],
  target: fetchStatusFx,
});

// the widget and the tray agenda live in separate windows and learn about sign-in and sign-out from here
signInFx.done.watch(() => broadcast("auth-changed"));
signOutFx.finally.watch(() => broadcast("auth-changed"));
