// A change of one field without the form (Ctrl+K: Google Meet, color): the event is saved with it
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventDraft } from "../shared/api/types";
import { toCalendarEvent } from "../shared/api/calendar";
import { eventPatched, patchFx } from "./editor";

const dentist = toCalendarEvent("me@example.com\u0000primary", {
  id: "e1",
  summary: "Dentist",
  colorId: "5",
  start: { dateTime: "2026-11-11T16:00:00+01:00" },
  end: { dateTime: "2026-11-11T16:45:00+01:00" },
  organizer: { email: "me@example.com", self: true },
}) as CalendarEvent;

describe("change one field", () => {
  it("the draft of the event with the change goes to Google", async () => {
    const saved: EventDraft[] = [];
    const scope = fork({ handlers: [[patchFx, (d: EventDraft) => void saved.push(d)]] });
    await allSettled(eventPatched, { scope, params: { event: dentist, patch: { addMeet: true } } });
    await allSettled(eventPatched, { scope, params: { event: dentist, patch: { colorId: "" } } });
    expect(saved[0]).toMatchObject({ id: "e1", title: "Dentist", addMeet: true, colorId: "5" });
    expect(saved[1]).toMatchObject({ id: "e1", colorId: "" });
  });
});
