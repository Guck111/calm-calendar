// Keys on a chosen event block: Enter opens, E edits, Ctrl+D duplicates, Delete asks to delete
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../shared/api/types";
import { toCalendarEvent } from "../shared/api/calendar";
import { $events } from "./events";
import { $deleteArmed, $draft, $mode, $opened, editorClosed, eventOpened } from "./editor";
import { eventKeyPressed } from "./keyboard";

const MINE = "me@example.com\u0000primary";

const dentist = toCalendarEvent(MINE, {
  id: "e1",
  summary: "Dentist",
  start: { dateTime: "2026-11-11T16:00:00+01:00" },
  end: { dateTime: "2026-11-11T16:45:00+01:00" },
  organizer: { email: "me@example.com", self: true },
}) as CalendarEvent;

const scope = () => fork({ values: [[$events, [dentist]]] });

describe("keys on an event", () => {
  it("open: the card", async () => {
    const s = scope();
    await allSettled(eventKeyPressed, { scope: s, params: { key: dentist.key, action: "open" } });
    expect(s.getState($opened)?.title).toBe("Dentist");
    expect(s.getState($mode)).toBe("view");
  });

  it("edit: the form of this event", async () => {
    const s = scope();
    await allSettled(eventKeyPressed, { scope: s, params: { key: dentist.key, action: "edit" } });
    expect(s.getState($mode)).toBe("edit");
    expect(s.getState($draft)).toMatchObject({ id: "e1", title: "Dentist" });
  });

  it("duplicate: the form of a new event with the same fields", async () => {
    const s = scope();
    await allSettled(eventKeyPressed, { scope: s, params: { key: dentist.key, action: "duplicate" } });
    expect(s.getState($mode)).toBe("edit");
    expect(s.getState($draft)?.id).toBeUndefined();
    expect(s.getState($draft)?.title).toBe("Dentist");
  });

  it("delete: the card with the delete button already asking", async () => {
    const s = scope();
    await allSettled(eventKeyPressed, { scope: s, params: { key: dentist.key, action: "delete" } });
    expect(s.getState($opened)?.title).toBe("Dentist");
    expect(s.getState($deleteArmed)).toBe(true);
    // a card opened by a click or closed — no longer armed
    await allSettled(editorClosed, { scope: s });
    expect(s.getState($deleteArmed)).toBe(false);
    await allSettled(eventKeyPressed, { scope: s, params: { key: dentist.key, action: "delete" } });
    await allSettled(eventOpened, { scope: s, params: dentist });
    expect(s.getState($deleteArmed)).toBe(false);
  });

  it("an unknown key does nothing", async () => {
    const s = scope();
    await allSettled(eventKeyPressed, { scope: s, params: { key: "gone", action: "edit" } });
    expect(s.getState($opened)).toBeNull();
    expect(s.getState($mode)).toBe("view");
  });
});
