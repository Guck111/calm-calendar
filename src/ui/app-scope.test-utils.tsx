// A model scope for component tests: accounts, calendars and events as given, nothing from the demo data.
import { allSettled, fork, type Scope } from "effector";
import { Provider } from "effector-react";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { $status, fetchStatusFx } from "../model/auth";
import { fetchCalendarsFx } from "../model/calendars";
import { fetchEventsFx } from "../model/events";
import type { Calendar, CalendarEvent } from "../shared/api/types";

export const ME = "me@example.com";
export const WORK = "me@work.com";
export const MINE = `${ME}\u0000primary`;
export const TEAM = `${ME}\u0000team`;
export const WORK_CAL = `${WORK}\u0000primary`;
export const SHARED = `${ME}\u0000shared`;

export const calendar = (id: string, over: Partial<Calendar> = {}): Calendar => ({
  id,
  googleId: id.split("\u0000")[1],
  account: id.split("\u0000")[0],
  name: id.split("\u0000")[1],
  color: "#4285f4",
  textColor: "#ffffff",
  accessRole: "owner",
  primary: false,
  selected: true,
  defaultReminders: [],
  ...over,
});

export const CALENDARS = [
  calendar(MINE, { name: "Personal" }),
  calendar(TEAM, { name: "Team" }),
  calendar(WORK_CAL, { name: "Work" }),
  calendar(SHARED, { name: "Shared", accessRole: "reader" }),
];

/** Wednesday, November 11, 2026, 16:00–16:45 local time unless given */
export const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: "k1",
  id: "e1",
  calendarId: MINE,
  account: ME,
  title: "Dentist",
  start: new Date(2026, 10, 11, 16, 0),
  end: new Date(2026, 10, 11, 16, 45),
  allDay: false,
  recurring: false,
  ...over,
});

export type AppSetup = {
  accounts?: string[];
  calendars?: Calendar[];
  events?: CalendarEvent[];
  values?: [unknown, unknown][];
  handlers?: [unknown, unknown][];
};

/** Loaded calendars ask for the events and the sign-in status: both come from here */
export const appScope = async ({ accounts = [ME], calendars = CALENDARS, events = [], values = [], handlers = [] }: AppSetup = {}) => {
  const status = { clientSource: "build" as const, accounts: accounts.map((email) => ({ email, signedIn: true })) };
  const scope: Scope = fork({
    values: [[$status, status], ...values] as never,
    handlers: [
      [fetchStatusFx, async () => status],
      [fetchCalendarsFx, async () => ({ calendars, failed: [], lost: [] })],
      [fetchEventsFx, async ({ id }: { id: number }) => ({ events, failed: [], lost: false, id })],
      ...handlers,
    ] as never,
  });
  await allSettled(fetchCalendarsFx, { scope, params: { accounts, id: 1 } });
  return scope;
};

export const renderIn = (scope: Scope, ui: ReactNode) => render(<Provider value={scope}>{ui}</Provider>);
