// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { allSettled, createWatch, type EventCallable } from "effector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteArmed, deleteRequested, draftOpened, editorClosed, eventOpened, loadSeriesFx, rsvpFx, saveFx, slotClicked } from "../model/editor";
import type { Calendar, CalendarEvent, EventDraft } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { formatFullDate, formatShortDate, formatTime, localTimeZone } from "../shared/lib/date";
import { fromZoned } from "../shared/lib/tz";
import { CALENDARS, ME, MINE, SHARED, TEAM, WORK, WORK_CAL, appScope, calendar, event, renderIn } from "./app-scope.test-utils";
import { EventEditor } from "./EventEditor";

const mocks = vi.hoisted(() => ({ openExternal: vi.fn(async (_href: string) => {}) }));
vi.mock("../shared/api/open", () => ({ openExternal: mocks.openExternal }));

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLang("ru");
});

// a zone that is not the test machine's, for the time zone notes
const OTHER_ZONE = localTimeZone() === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";

type Setup = {
  open: [EventCallable<any>, unknown];
  accounts?: string[];
  calendars?: Calendar[];
  events?: CalendarEvent[];
  series?: string[];
  seriesFails?: boolean;
  saving?: Promise<void>;
};

const show = async ({ open, accounts, calendars, events, series = [], seriesFails, saving }: Setup) => {
  const saves = vi.fn(async (_p: { draft: EventDraft; scope: string }) => saving);
  const answers = vi.fn(async (_p: { event: CalendarEvent; status: string }) => {});
  const series$ = async () => {
    if (seriesFails) throw { kind: "other", message: "no series" };
    return series;
  };
  const scope = await appScope({ accounts, calendars, events, handlers: [[saveFx, saves], [rsvpFx, answers], [loadSeriesFx, series$]] });
  const deletes = vi.fn();
  createWatch({ unit: deleteRequested, scope, fn: deletes });
  await allSettled(open[0], { scope, params: open[1] });
  renderIn(scope, <EventEditor />);
  return { scope, saves, answers, deletes };
};

const opened = (over: Partial<CalendarEvent> = {}, rest: Omit<Setup, "open"> = {}) =>
  show({ open: [eventOpened, event(over)], ...rest });

const created = (rest: Omit<Setup, "open"> = {}) =>
  show({ open: [slotClicked, { start: new Date(2026, 10, 11, 9, 0) }], ...rest });

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const noButton = (name: string | RegExp) => expect(screen.queryByRole("button", { name })).toBeNull();
const dialog = () => screen.queryByRole("dialog");
const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));

describe("event card", () => {
  it("shows the title, the time, the calendar and closes with the cross", async () => {
    await opened();
    const card = dialog() as HTMLElement;
    expect(card.getAttribute("aria-label")).toBe("Event");
    expect(screen.getByRole("heading").textContent).toBe("Dentist");
    expect(within(card).getByText(`${formatFullDate(event().start)}, ${formatTime(event().start)}–${formatTime(event().end)}`)).toBeTruthy();
    expect(within(card).getByText("Personal")).toBeTruthy();
    // one account: no account name next to the calendar
    expect(within(card).queryByText(ME)).toBeNull();
    fireEvent.click(button("Close"));
    expect(dialog()).toBeNull();
  });

  it("with several accounts the card names the account of the calendar", async () => {
    await opened({}, { accounts: [ME, WORK] });
    expect(screen.getByText(ME)).toBeTruthy();
  });

  it("an event over midnight shows both dates", async () => {
    const start = new Date(2026, 10, 11, 23, 0);
    const end = new Date(2026, 10, 12, 1, 0);
    await opened({ start, end });
    expect(screen.getByText(`${formatFullDate(start)}, ${formatTime(start)} — ${formatFullDate(end)}, ${formatTime(end)}`)).toBeTruthy();
  });

  it("an all-day event shows its day, a longer one its first and last day", async () => {
    await opened({ allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12) });
    expect(screen.getByText(`${formatFullDate(new Date(2026, 10, 11))}, all day`)).toBeTruthy();
    cleanup();
    await opened({ allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 14) });
    expect(screen.getByText(`${formatFullDate(new Date(2026, 10, 11))} — ${formatFullDate(new Date(2026, 10, 13))}`)).toBeTruthy();
  });

  it("the place opens in Google Maps, a link opens as it is", async () => {
    await opened({ location: "Gdynia, Świętojańska 1" });
    fireEvent.click(button("Gdynia, Świętojańska 1"));
    expect(mocks.openExternal).toHaveBeenCalledWith(
      "https://www.google.com/maps/search/?api=1&query=Gdynia%2C%20%C5%9Awi%C4%99toja%C5%84ska%201",
    );
    expect(button("Gdynia, Świętojańska 1").title).toBe("Open in Google Maps");
  });

  it("Join opens the video meeting, Open in Google the event page", async () => {
    await opened({
      meeting: { provider: "Google Meet", url: "https://meet.google.com/abc" } as CalendarEvent["meeting"],
      htmlLink: "https://calendar.google.com/event?eid=1",
    });
    const join = button(/Join/);
    expect(join.title).toBe("Join with Google Meet");
    fireEvent.click(join);
    expect(mocks.openExternal).toHaveBeenLastCalledWith("https://meet.google.com/abc");
    fireEvent.click(button(/In Google/));
    expect(mocks.openExternal).toHaveBeenLastCalledWith("https://calendar.google.com/event?eid=1");
  });

  it("no link to Google for an event without one", async () => {
    await opened();
    noButton(/In Google/);
  });

  it("guests with their answers, attachments, description as plain text and travel time", async () => {
    await opened({
      attendees: [
        { email: ME, self: true, organizer: true, responseStatus: "accepted" },
        { email: "anna@example.com", displayName: "Anna", responseStatus: "declined" },
        { email: "bob@example.com", responseStatus: "tentative" },
      ],
      attachments: [{ fileUrl: "https://drive.google.com/file/d/1/view", title: "Plan.pdf" }],
      description: "<b>Bring</b> the X-ray",
      travelMinutes: 30,
    });
    const card = dialog() as HTMLElement;
    expect(within(card).getByText("organizer")).toBeTruthy();
    expect(within(card).getByText("Anna").getAttribute("title")).toBe("anna@example.com");
    expect(within(card).getByText("not going")).toBeTruthy();
    expect(within(card).getByText("maybe")).toBeTruthy();
    expect(within(card).getByText("Bring the X-ray")).toBeTruthy();
    expect(within(card).getByText("Travel time")).toBeTruthy();
    fireEvent.click(button(/Plan\.pdf/));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://drive.google.com/file/d/1/view");
  });

  it("an all-day event shows no travel time", async () => {
    await opened({ allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12), travelMinutes: 30 });
    expect(screen.queryByText("Travel time")).toBeNull();
  });

  it("the same meeting in another account is named, an overlap with another account is warned about", async () => {
    const call = event({ key: "k2", id: "e2", calendarId: WORK_CAL, account: WORK, title: "Call" });
    await opened({ alsoIn: [WORK_CAL] }, { accounts: [ME, WORK], events: [event({ alsoIn: [WORK_CAL] }), call] });
    expect(screen.getByText(`Also in: ${WORK}`)).toBeTruthy();
    cleanup();
    await opened({}, { accounts: [ME, WORK], events: [event(), call] });
    expect(screen.getByText(/^Overlaps with: Call/)).toBeTruthy();
  });

  it("an event in another time zone shows its own clock and zone", async () => {
    await opened({ timeZone: OTHER_ZONE });
    expect(screen.getByText(new RegExp(OTHER_ZONE.split("/")[1].replace("_", " ")))).toBeTruthy();
  });

  it("in the system time zone there is no zone note", async () => {
    await opened({ timeZone: localTimeZone() });
    expect(screen.queryByText(/GMT/)).toBeNull();
  });

  it("a read-only calendar: a note, no Edit and Delete, Duplicate still there", async () => {
    await opened({ calendarId: SHARED });
    expect(screen.getByText("Read-only calendar.")).toBeTruthy();
    noButton("Edit");
    noButton("Delete");
    expect(button("Duplicate")).toBeTruthy();
  });

  it("without writable calendars there is nothing to copy into", async () => {
    await opened({ calendarId: SHARED }, { calendars: [calendar(SHARED, { accessRole: "reader" })] });
    noButton("Duplicate");
  });

  it("Duplicate opens the form of a new event with the same title", async () => {
    await opened();
    fireEvent.click(button("Duplicate"));
    expect(dialog()?.getAttribute("aria-label")).toBe("New event");
    expect((screen.getByPlaceholderText("Title") as HTMLInputElement).value).toBe("Dentist");
  });

  it("Delete of a one-off event deletes it at once", async () => {
    const { deletes } = await opened();
    fireEvent.click(button("Delete"));
    await waitFor(() => expect(deletes).toHaveBeenCalledWith(expect.objectContaining({ scope: "this" })));
  });

  it("Delete of a series occurrence asks which events, Cancel and Esc take the question back", async () => {
    const { deletes } = await opened({ recurring: true, recurringEventId: "master" });
    fireEvent.click(button("Delete"));
    const ask = screen.getByRole("group", { name: "Delete recurring event" });
    expect(within(ask).getByRole("button", { name: "This event" })).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Delete recurring event" })).toBeNull();

    fireEvent.click(button("Delete"));
    key("Escape");
    expect(screen.queryByRole("group", { name: "Delete recurring event" })).toBeNull();
    expect(dialog()).not.toBeNull();

    fireEvent.click(button("Delete"));
    fireEvent.click(button("This and following events"));
    await waitFor(() => expect(deletes).toHaveBeenCalledWith(expect.objectContaining({ scope: "following" })));
  });

  it("a series occurrence describes its repeat once the rule has loaded", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    await waitFor(() => expect(screen.getByText(/day/i)).toBeTruthy());
    expect(screen.queryByText("Recurring event.")).toBeNull();
  });

  it("while the series rule is unknown the card says just recurring", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { seriesFails: true });
    expect(screen.getByText("Recurring event.")).toBeTruthy();
  });

  it("an invitation: the current answer is pressed, another one is sent, the same one is not", async () => {
    const { answers } = await opened({
      organizerSelf: false,
      attendees: [{ email: ME, self: true, responseStatus: "tentative" }],
    });
    const rsvp = screen.getByRole("group", { name: "Going?" });
    const maybe = within(rsvp).getByRole("button", { name: "Maybe" });
    expect(maybe.getAttribute("aria-pressed")).toBe("true");
    expect(within(rsvp).getByRole("button", { name: "Yes" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(maybe);
    expect(answers).not.toHaveBeenCalled();
    fireEvent.click(within(rsvp).getByRole("button", { name: "No" }));
    await waitFor(() => expect(answers).toHaveBeenCalledWith(expect.objectContaining({ status: "declined" })));
  });

  it("my own event has no Going? question", async () => {
    await opened({ attendees: [{ email: ME, self: true, organizer: true }] });
    expect(screen.queryByRole("group", { name: "Going?" })).toBeNull();
  });

  it("Edit opens the form, Esc there returns to the card, Esc on the card closes it", async () => {
    await opened();
    fireEvent.click(button("Edit"));
    expect(screen.getByPlaceholderText("Title")).toBeTruthy();
    key("Escape");
    expect(screen.getByRole("heading").textContent).toBe("Dentist");
    key("Escape");
    expect(dialog()).toBeNull();
  });

  it("other keys leave the card open", async () => {
    await opened();
    key("Enter");
    expect(dialog()).not.toBeNull();
  });

  it("a click on the backdrop closes the card, a click inside does not", async () => {
    await opened();
    const card = dialog() as HTMLElement;
    fireEvent.mouseDown(card);
    expect(dialog()).not.toBeNull();
    fireEvent.mouseDown(card.parentElement as HTMLElement);
    expect(dialog()).toBeNull();
  });
});

describe("event form", () => {
  it("a new event: Save sends the draft, there is no Delete and Cancel", async () => {
    const { saves } = await created();
    expect(dialog()?.getAttribute("aria-label")).toBe("New event");
    noButton("Delete");
    noButton("Cancel");
    type(screen.getByPlaceholderText("Title"), "Gym");
    type(input("Location"), "Club");
    type(screen.getByPlaceholderText("Agenda, links, notes"), "Bring shoes");
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1));
    expect(saves.mock.calls[0][0]).toMatchObject({
      scope: "this",
      draft: { title: "Gym", location: "Club", description: "Bring shoes", calendarId: MINE, startTime: "09:00" },
    });
  });

  it("the end before the start is an error, nothing is saved", async () => {
    const { saves } = await created();
    type(screen.getByLabelText("End time"), "08:00");
    fireEvent.click(button("Save"));
    await waitFor(() => expect(dialog()?.textContent).toMatch(/end/i));
    expect(saves).not.toHaveBeenCalled();
  });

  it("moving the start moves the end; dates change too", async () => {
    await created();
    type(screen.getByLabelText("Start time"), "10:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("11:00");
    type(screen.getByLabelText("Start date"), "2026-11-12");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-12");
    type(screen.getByLabelText("End date"), "2026-11-13");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-11-13");
    type(screen.getByLabelText("End time"), "12:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("12:00");
  });

  it("All day hides the times and the time zone, travel time", async () => {
    await created();
    fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    expect(screen.queryByLabelText("Start time")).toBeNull();
    expect(screen.queryByLabelText("End time")).toBeNull();
    expect(button(/More/).textContent).not.toMatch(/Time zone/);
    fireEvent.click(button(/More/));
    expect(screen.queryByText("Travel time")).toBeNull();
  });

  it("calendars of several accounts are grouped by account", async () => {
    const { saves } = await created({ accounts: [ME, WORK] });
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual([ME, WORK]);
    fireEvent.change(select, { target: { value: WORK_CAL } });
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves.mock.calls[0][0].draft.calendarId).toBe(WORK_CAL));
  });

  it("one account: plain list of its writable calendars", async () => {
    await created({ calendars: [calendar(MINE, { name: "Personal" }), calendar(TEAM, { name: "Team" })] });
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect(select.querySelector("optgroup")).toBeNull();
    expect([...select.options].map((o) => o.text)).toEqual(["Personal", "Team"]);
  });

  it("an existing event moves only between calendars of its account", async () => {
    await opened({}, { accounts: [ME, WORK] });
    fireEvent.click(button("Edit"));
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Personal", "Team"]);
  });

  it("a series occurrence can't change calendar: it is shown as text", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    fireEvent.click(button("Edit"));
    const field = screen.getByText("Calendar").parentElement as HTMLElement;
    expect(within(field).queryByRole("combobox")).toBeNull();
    expect(field.textContent).toContain("Personal");
  });

  it("an existing event: Cancel returns the card, Delete is there", async () => {
    await opened();
    fireEvent.click(button("Edit"));
    type(screen.getByPlaceholderText("Title"), "Changed");
    fireEvent.click(button("Cancel"));
    expect(screen.getByRole("heading").textContent).toBe("Dentist");
    fireEvent.click(button("Edit"));
    expect((screen.getByPlaceholderText("Title") as HTMLInputElement).value).toBe("Dentist");
    expect(button("Delete")).toBeTruthy();
  });

  it("saving a series occurrence asks which events; with a changed rule only this and following", async () => {
    const { saves } = await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    fireEvent.click(button("Edit"));
    fireEvent.click(button("Save"));
    const ask = screen.getByRole("group", { name: "Save recurring event" });
    expect(within(ask).getByRole("button", { name: "This event" })).toBeTruthy();
    expect(within(ask).queryByText(/repeat has changed/)).toBeNull();
    fireEvent.click(within(ask).getByRole("button", { name: "This event" }));
    await waitFor(() => expect(saves).toHaveBeenCalledWith(expect.objectContaining({ scope: "this" })));
  });

  it("a changed repeat rule leaves only this and following", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    fireEvent.click(button("Edit"));
    const repeat = screen.getAllByRole("combobox", { name: "Repeat" })[0];
    const weekly = [...(repeat as HTMLSelectElement).options].find((o) => o.value !== "none" && o.value !== (repeat as HTMLSelectElement).value);
    fireEvent.change(repeat, { target: { value: weekly?.value } });
    fireEvent.click(button("Save"));
    const ask = screen.getByRole("group", { name: "Save recurring event" });
    expect(within(ask).getByText(/repeat has changed/)).toBeTruthy();
    expect(within(ask).queryByRole("button", { name: "This event" })).toBeNull();
    expect(within(ask).getByRole("button", { name: "This and following events" })).toBeTruthy();
  });

  it("while the series rule fails to load the repeat field is hidden", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { seriesFails: true });
    fireEvent.click(button("Edit"));
    expect(screen.queryByRole("combobox", { name: "Repeat" })).toBeNull();
  });

  it("while saving the button says so and is disabled", async () => {
    let done = () => {};
    await created({ saving: new Promise<void>((r) => (done = r)) });
    fireEvent.click(button("Save"));
    await waitFor(() => expect(button("Saving…").hasAttribute("disabled")).toBe(true));
    await act(async () => done());
  });

  it("a video call can be added to an event without one", async () => {
    const { saves } = await created();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Google Meet video call" }));
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves.mock.calls[0][0].draft.addMeet).toBe(true));
  });

  it("an event with a video call offers no second one", async () => {
    await opened({ meeting: { provider: "Zoom", url: "https://zoom.us/j/1" } as CalendarEvent["meeting"] });
    fireEvent.click(button("Edit"));
    expect(screen.queryByRole("checkbox", { name: "Add Google Meet video call" })).toBeNull();
  });
});

describe("guests in the form", () => {
  const guests = () => screen.getByRole("textbox", { name: "Add a guest by email" }) as HTMLInputElement;

  it("Enter, comma and leaving the field add guests; a known one is not added twice", async () => {
    const { saves } = await created();
    type(guests(), "anna@example.com");
    fireEvent.keyDown(guests(), { key: "Enter" });
    expect(guests().value).toBe("");
    type(guests(), "bob@example.com");
    fireEvent.keyDown(guests(), { key: "," });
    type(guests(), "ANNA@example.com carl@example.com");
    fireEvent.blur(guests());
    expect(screen.getByText("Guests get an email from Google about the meeting and its changes.")).toBeTruthy();
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves).toHaveBeenCalled());
    expect(saves.mock.calls[0][0].draft.guests).toEqual([
      { email: "anna@example.com" },
      { email: "bob@example.com" },
      { email: "carl@example.com" },
    ]);
  });

  it("a wrong address is marked and kept in the field until fixed", async () => {
    await created();
    type(guests(), "anna@");
    fireEvent.keyDown(guests(), { key: "Enter" });
    expect(guests().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("This doesn't look like an email")).toBeTruthy();
    expect(guests().value).toBe("anna@");
    type(guests(), "anna@example.com");
    expect(guests().getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText("This doesn't look like an email")).toBeNull();
  });

  it("other keys and an empty field add nobody", async () => {
    await created();
    fireEvent.keyDown(guests(), { key: "Enter" });
    type(guests(), "anna@example.com");
    fireEvent.keyDown(guests(), { key: "a" });
    expect(guests().value).toBe("anna@example.com");
    type(guests(), "   ");
    fireEvent.blur(guests());
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a guest can be removed, the organizer and I can't; answers are shown", async () => {
    await opened({
      attendees: [
        { email: ME, self: true, organizer: true, responseStatus: "accepted" },
        { email: "anna@example.com", displayName: "Anna", responseStatus: "needsAction" },
      ],
    });
    fireEvent.click(button("Edit"));
    expect(screen.getByText("organizer")).toBeTruthy();
    expect(screen.getByText("no reply yet")).toBeTruthy();
    noButton(`Remove ${ME}`);
    fireEvent.click(button("Remove anna@example.com"));
    expect(screen.queryByText("Anna")).toBeNull();
    // only I am left: guests get no email
    expect(screen.queryByText(/Guests get an email/)).toBeNull();
  });

  it("someone else's meeting: no guest list to change", async () => {
    await opened({ organizerSelf: false, attendees: [{ email: ME, self: true, responseStatus: "accepted" }] });
    fireEvent.click(button("Edit"));
    expect(screen.queryByRole("textbox", { name: "Add a guest by email" })).toBeNull();
  });
});

describe("More in the form", () => {
  const more = () => button(/More/);

  it("closed for a plain event and lists what is inside; opens and closes by click", async () => {
    await created();
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect(more().textContent).toContain("Time zone, Travel time, Color, Attachments");
    fireEvent.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(more().textContent).not.toContain("Travel time");
    expect(screen.getByRole("radiogroup", { name: "Color" })).toBeTruthy();
    fireEvent.click(more());
    expect(screen.queryByRole("radiogroup", { name: "Color" })).toBeNull();
  });

  it("open at once when the event uses one of its fields", async () => {
    await opened({ colorId: "5" });
    fireEvent.click(button("Edit"));
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: "Banana" }).getAttribute("aria-checked")).toBe("true");
  });

  it("a color is picked, the calendar color brings it back", async () => {
    const { saves } = await created();
    fireEvent.click(more());
    expect(screen.getByRole("radio", { name: "Calendar color" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Tomato" }));
    expect(screen.getByRole("radio", { name: "Tomato" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio")).toHaveLength(12);
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves.mock.calls[0][0].draft.colorId).toBe("11"));
  });

  it("travel time: the usual choices, and an unusual saved value too", async () => {
    await opened({ travelMinutes: 25 });
    fireEvent.click(button("Edit"));
    const travel = screen.getByText("Travel time").parentElement?.querySelector("select") as HTMLSelectElement;
    expect(travel.value).toBe("25");
    expect([...travel.options].map((o) => Number(o.value))).toEqual([0, 5, 10, 15, 25, 30, 45, 60, 90, 120]);
    expect(travel.options[0].text).toBe("None");
    fireEvent.change(travel, { target: { value: "60" } });
    expect(travel.value).toBe("60");
  });

  it("another time zone shows the time in mine", async () => {
    await created();
    fireEvent.click(more());
    expect(screen.queryByText(/^Your time:/)).toBeNull();
    const zone = screen.getByText("Time zone").parentElement?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(zone, { target: { value: OTHER_ZONE } });
    const start = fromZoned("2026-11-11", "09:00", OTHER_ZONE);
    expect(screen.getByText(/^Your time:/).textContent).toContain(`${formatShortDate(start)}, ${formatTime(start)}`);
  });

  it("attachments: a Drive link is added once, other links are refused, a file can be removed", async () => {
    const { saves } = await created();
    fireEvent.click(more());
    const link = () => screen.getByRole("textbox", { name: "Paste a Google Drive link" }) as HTMLInputElement;
    type(link(), "https://example.com/file");
    fireEvent.keyDown(link(), { key: "Enter" });
    expect(screen.getByText("Only links to Google Drive files can be attached")).toBeTruthy();
    expect(link().getAttribute("aria-invalid")).toBe("true");
    type(link(), "https://drive.google.com/file/d/abc/view");
    expect(link().getAttribute("aria-invalid")).toBe("false");
    fireEvent.keyDown(link(), { key: "Enter" });
    type(link(), "https://drive.google.com/file/d/abc/view");
    fireEvent.blur(link());
    expect(screen.getAllByText("Google Drive")).toHaveLength(1);
    fireEvent.keyDown(link(), { key: "Enter" });
    expect(screen.queryByText("Only links to Google Drive files can be attached")).toBeNull();

    type(link(), "https://docs.google.com/document/d/doc1/edit");
    fireEvent.blur(link());
    fireEvent.click(button("Remove Google Drive"));
    expect(screen.queryByText("Google Drive")).toBeNull();
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves).toHaveBeenCalled());
    expect(saves.mock.calls[0][0].draft.attachments).toEqual([
      expect.objectContaining({ fileUrl: "https://docs.google.com/document/d/doc1/edit", title: "Google Docs" }),
    ]);
  });

  it("no more attachments past the limit", async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ fileUrl: `https://drive.google.com/file/d/${i}/view`, title: `File ${i}` }));
    await opened({ attachments: files });
    fireEvent.click(button("Edit"));
    expect(screen.queryByRole("textbox", { name: "Paste a Google Drive link" })).toBeNull();
  });

  it("someone else's meeting has no attachments field", async () => {
    await opened({ organizerSelf: false, attendees: [{ email: ME, self: true }] });
    fireEvent.click(button("Edit"));
    fireEvent.click(more());
    expect(screen.queryByRole("textbox", { name: "Paste a Google Drive link" })).toBeNull();
    expect(more().textContent).not.toContain("Attachments");
  });
});

describe("draft opened from elsewhere", () => {
  it("quick add's draft opens as a new event form", async () => {
    const draft: EventDraft = {
      calendarId: MINE,
      title: "Lunch",
      allDay: false,
      startDate: "2026-11-11",
      startTime: "13:00",
      endDate: "2026-11-11",
      endTime: "14:00",
      location: "",
      description: "",
      recurrence: [],
    };
    await show({ open: [draftOpened, draft] });
    expect((screen.getByPlaceholderText("Title") as HTMLInputElement).value).toBe("Lunch");
    expect(screen.queryByRole("checkbox", { name: "Add Google Meet video call" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Add a guest by email" })).toBeNull();
  });
});

describe("details of the card and the form", () => {
  const cls = (el: Element | null | undefined) => el?.className ?? "";

  it("the occurrences question: deleting is red without a fill, saving offers this event first", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    fireEvent.click(button("Delete"));
    expect(cls(button("This event"))).toContain("danger");
    expect(cls(button("This event"))).not.toContain("primary");
    expect(cls(button("This and following events"))).toContain("danger");
    expect(document.activeElement).toBe(button("This event"));
    fireEvent.click(button("Cancel"));
    fireEvent.click(button("Edit"));
    fireEvent.click(button("Save"));
    expect(cls(button("This event"))).toContain("primary");
    expect(cls(button("This event"))).not.toContain("danger");
    expect(cls(button("This and following events"))).not.toContain("primary");
    expect(cls(button("This and following events"))).not.toContain("danger");
  });

  it("with a changed rule this and following is the main choice; deleting still asks about this event", async () => {
    await opened({ recurring: true, recurringEventId: "master" }, { series: ["RRULE:FREQ=DAILY"] });
    fireEvent.click(button("Edit"));
    const repeat = screen.getAllByRole("combobox", { name: "Repeat" })[0] as HTMLSelectElement;
    const other = [...repeat.options].find((o) => !["none", repeat.value, "special", "custom", "loading"].includes(o.value));
    fireEvent.change(repeat, { target: { value: other?.value } });
    fireEvent.click(button("Save"));
    expect(cls(button("This and following events"))).toContain("primary");
    expect(document.activeElement).toBe(button("This and following events"));
    fireEvent.click(button("Cancel"));
    fireEvent.click(button("Delete"));
    expect(button("This event")).toBeTruthy();
  });

  it("while the series rule loads, the repeat list waits", async () => {
    const pending = new Promise<string[]>(() => {});
    const scope = await appScope({ handlers: [[loadSeriesFx, () => pending]] });
    void allSettled(eventOpened, { scope, params: event({ recurring: true, recurringEventId: "master" }) });
    await act(async () => {});
    renderIn(scope, <EventEditor />);
    expect(screen.getByText("Recurring event.")).toBeTruthy();
    fireEvent.click(button("Edit"));
    expect((screen.getAllByRole("combobox", { name: "Repeat" })[0] as HTMLSelectElement).disabled).toBe(true);
  });

  it("an answer that failed shows its error on the card", async () => {
    const scope = await appScope({ handlers: [[rsvpFx, async () => Promise.reject({ kind: "network", message: "No internet" })]] });
    await allSettled(eventOpened, {
      scope,
      params: event({ organizerSelf: false, attendees: [{ email: ME, self: true, responseStatus: "needsAction" }] }),
    });
    renderIn(scope, <EventEditor />);
    expect(dialog()?.querySelector("[class*=error]")).toBeNull();
    fireEvent.click(button("Yes"));
    await waitFor(() => expect(screen.getByText("No internet")).toBeTruthy());
  });

  it("the current answer is highlighted", async () => {
    await opened({ organizerSelf: false, attendees: [{ email: ME, self: true, responseStatus: "accepted" }] });
    expect(cls(button("Yes"))).toContain("rsvpOn");
    expect(cls(button("No"))).not.toContain("rsvpOn");
  });

  it("the card focuses Join for a call, Edit otherwise, Delete when opened by the Delete key", async () => {
    await opened({ meeting: { provider: "Zoom", url: "https://zoom.us/j/1" } as CalendarEvent["meeting"] });
    expect(document.activeElement).toBe(button(/Join/));
    expect(cls(button("Edit"))).not.toContain("primary");
    cleanup();
    await opened();
    expect(document.activeElement).toBe(button("Edit"));
    expect(cls(button("Edit"))).toContain("primary");
    cleanup();
    const scope = await appScope();
    await allSettled(eventOpened, { scope, params: event() });
    await allSettled(deleteArmed, { scope });
    renderIn(scope, <EventEditor />);
    expect(document.activeElement).toBe(button("Delete"));
  });

  it("the form focuses the title, not Delete", async () => {
    await opened();
    fireEvent.click(button("Edit"));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Title"));
  });

  it("an event in a calendar the app doesn't list names its id", async () => {
    await opened({ calendarId: "gone@example.com\u0000old" }, { accounts: [ME, WORK] });
    expect(screen.getByText("gone@example.com\u0000old", { exact: false })).toBeTruthy();
  });

  it("a subscription calendar has no account name even with several accounts", async () => {
    const feed = calendar("feed\u0000ics", { name: "Matches", feed: true, accessRole: "reader" });
    await opened({ calendarId: feed.id, account: ME }, { accounts: [ME, WORK], calendars: [...CALENDARS, feed] });
    expect(screen.getByText("Matches")).toBeTruthy();
    expect(screen.queryByText(ME)).toBeNull();
  });

  it("the same meeting in calendars the app doesn't list names their ids", async () => {
    await opened({ alsoIn: [WORK_CAL, "x\u0000y"] }, { accounts: [ME, WORK] });
    expect(screen.getByText(`Also in: ${WORK}, x\u0000y`)).toBeTruthy();
  });

  it("two overlaps are listed together", async () => {
    const other = (key: string, title: string) => event({ key, id: key, calendarId: WORK_CAL, account: WORK, title });
    await opened({}, { accounts: [ME, WORK], events: [event(), other("a", "Call"), other("b", "Lunch")] });
    const time = `${formatTime(event().start)}–${formatTime(event().end)}`;
    expect(screen.getByText(`Overlaps with: Call ${time} (${WORK}), Lunch ${time} (${WORK})`)).toBeTruthy();
  });

  it("an event in another zone shows its clock; a different end zone is named too", async () => {
    await opened({ timeZone: OTHER_ZONE, endTimeZone: "Europe/London" });
    const note = screen.getByText(/→/).textContent ?? "";
    expect(note).toMatch(/^\d{1,2}:\d{2}\s[AP]M–\d{1,2}:\d{2}\s[AP]M /);
    expect(note).toContain("London");
    cleanup();
    await opened({ timeZone: OTHER_ZONE });
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it("a declined guest is struck out on the card", async () => {
    await opened({ attendees: [{ email: "anna@example.com", responseStatus: "declined" }, { email: "bob@example.com" }] });
    expect(cls(screen.getByText("anna@example.com").parentElement)).toContain("declined");
    expect(cls(screen.getByText("bob@example.com").parentElement)).not.toContain("declined");
  });

  it("all-day: dates only, no time zone and travel under More", async () => {
    await created();
    const times = () => document.querySelector("[class*=times]");
    fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    expect(cls(times())).toContain("datesOnly");
    expect(button(/More/).textContent).toBe("MoreColor, Attachments");
    fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    expect(cls(times())).not.toContain("datesOnly");
    expect(button(/More/).textContent).toBe("MoreTime zone, Travel time, Color, Attachments");
  });

  it("someone else's meeting lists no attachments under More", async () => {
    await opened({ organizerSelf: false, attendees: [{ email: ME, self: true }] });
    fireEvent.click(button("Edit"));
    expect(button(/More/).textContent).toBe("MoreTime zone, Travel time, Color");
  });

  it("the More arrow turns when open", async () => {
    await created();
    const arrow = () => button(/More/).querySelector("[aria-hidden]");
    expect(cls(arrow())).not.toContain("moreOpen");
    fireEvent.click(button(/More/));
    expect(cls(arrow())).toContain("moreOpen");
  });

  it("More is open at once for travel time, its own zone or a separate end zone", async () => {
    for (const over of [{ travelMinutes: 30 }, { timeZone: OTHER_ZONE }, { endTimeZone: OTHER_ZONE }]) {
      await opened(over);
      fireEvent.click(button("Edit"));
      expect(button(/More/).getAttribute("aria-expanded")).toBe("true");
      cleanup();
    }
    await opened({ allDay: true, start: new Date(2026, 10, 11), end: new Date(2026, 10, 12), travelMinutes: 30 });
    fireEvent.click(button("Edit"));
    expect(button(/More/).getAttribute("aria-expanded")).toBe("false");
  });

  it("the calendar color is the first swatch; only the chosen one is marked", async () => {
    await created();
    fireEvent.click(button(/More/));
    const radios = screen.getAllByRole("radio");
    expect(cls(radios[0])).toContain("calendarColor");
    expect(cls(radios[1])).not.toContain("calendarColor");
    expect(cls(radios[0])).toContain("colorOn");
    expect(cls(radios[1])).not.toContain("colorOn");
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("calendars of several accounts: each group has only its account's calendars", async () => {
    await created({ accounts: [ME, WORK] });
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const groups = [...select.querySelectorAll("optgroup")].map((g) => [...g.querySelectorAll("option")].map((o) => o.text));
    expect(groups).toEqual([["Personal", "Team"], ["Work"]]);
  });

  it("a form error shows only when there is one", async () => {
    await created();
    expect(dialog()?.querySelector("[class*=error]")).toBeNull();
    type(screen.getByLabelText("End time"), "08:00");
    fireEvent.click(button("Save"));
    expect(await screen.findByText("The event ends before it starts")).toBeTruthy();
  });

  it("submitting the form doesn't reload the page", async () => {
    const { saves } = await created();
    type(screen.getByPlaceholderText("Title"), "Gym");
    expect(fireEvent.submit(screen.getByPlaceholderText("Title").closest("form") as HTMLFormElement)).toBe(false);
    await waitFor(() => expect(saves).toHaveBeenCalled());
  });

  it("the form's cross closes it, its Delete deletes", async () => {
    await created();
    fireEvent.click(button("Close"));
    expect(dialog()).toBeNull();
    cleanup();
    const { deletes } = await opened();
    fireEvent.click(button("Edit"));
    fireEvent.click(button("Delete"));
    await waitFor(() => expect(deletes).toHaveBeenCalled());
  });

  it("with nothing open Esc does nothing", async () => {
    const scope = await appScope();
    const closes = vi.fn();
    createWatch({ unit: editorClosed, scope, fn: closes });
    renderIn(scope, <EventEditor />);
    key("Escape");
    expect(closes).not.toHaveBeenCalled();
  });

  it("the card stands beside the block it was opened from", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const box = { x: 100, y: 100, top: 100, left: 100, right: 200, bottom: 160, width: 100, height: 60, toJSON: () => ({}) };
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box as DOMRect);
    const main = document.createElement("main");
    main.innerHTML = '<button data-event-key="k1">Dentist</button>';
    document.body.append(main);
    (main.firstElementChild as HTMLElement).focus();
    await opened();
    expect(cls(dialog())).toContain("beside");
    expect(cls(dialog()?.parentElement)).toContain("clear");
    cleanup();
    main.remove();
    await opened();
    expect(cls(dialog())).not.toContain("beside");
    expect(cls(dialog()?.parentElement)).not.toContain("clear");
    rect.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("guest and attachment fields in detail", () => {
  const guests = () => screen.getByRole("textbox", { name: "Add a guest by email" }) as HTMLInputElement;
  const link = () => screen.getByRole("textbox", { name: "Paste a Google Drive link" }) as HTMLInputElement;

  it("an address must be whole: nothing before or after it", async () => {
    await created();
    expect(guests().getAttribute("aria-invalid")).toBe("false");
    for (const bad of ["@anna@example.com", "anna@example.com@"]) {
      type(guests(), bad);
      fireEvent.blur(guests());
      expect(guests().getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("separators around addresses are ignored", async () => {
    const { saves } = await created();
    type(guests(), " anna@example.com;; bob@example.com, ");
    fireEvent.blur(guests());
    expect(guests().getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves).toHaveBeenCalled());
    expect(saves.mock.calls[0][0].draft.guests).toEqual([{ email: "anna@example.com" }, { email: "bob@example.com" }]);
  });

  it("Enter with an address is kept from the form; an empty one is not", async () => {
    await created();
    type(guests(), "anna@example.com");
    expect(fireEvent.keyDown(guests(), { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(guests(), { key: "Enter" })).toBe(true);
    type(guests(), "   ");
    expect(fireEvent.keyDown(guests(), { key: "," })).toBe(true);
  });

  it("names are shown instead of addresses; removing one keeps the rest", async () => {
    const { saves } = await opened({
      attendees: [
        { email: ME, self: true, organizer: true },
        { email: "anna@example.com", displayName: "Anna" },
        { email: "bob@example.com" },
      ],
    });
    fireEvent.click(button("Edit"));
    expect(screen.getByText("Anna").getAttribute("title")).toBe("anna@example.com");
    fireEvent.click(button("Remove anna@example.com"));
    expect(screen.getByText("bob@example.com")).toBeTruthy();
    fireEvent.click(button("Save"));
    await waitFor(() => expect(saves).toHaveBeenCalled());
    expect(saves.mock.calls[0][0].draft.guests?.map((g) => g.email)).toEqual([ME, "bob@example.com"]);
  });

  it("neither the organizer nor I can be removed, whoever organizes", async () => {
    await opened({ attendees: [{ email: "boss@example.com", organizer: true }, { email: ME, self: true }] });
    fireEvent.click(button("Edit"));
    noButton("Remove boss@example.com");
    noButton(`Remove ${ME}`);
  });

  it("attachments: a blank link is no error, only Enter adds, an empty Enter is not kept", async () => {
    await created();
    fireEvent.click(button(/More/));
    expect(link().getAttribute("aria-invalid")).toBe("false");
    expect(document.querySelector("[class*=files]")).toBeNull();
    type(link(), "   ");
    fireEvent.blur(link());
    expect(link().getAttribute("aria-invalid")).toBe("false");
    expect(fireEvent.keyDown(link(), { key: "Enter" })).toBe(true);
    type(link(), "https://drive.google.com/file/d/abc/view");
    fireEvent.keyDown(link(), { key: "a" });
    expect(screen.queryByText("Google Drive")).toBeNull();
    expect(fireEvent.keyDown(link(), { key: "Enter" })).toBe(false);
    expect(screen.getByText("Google Drive")).toBeTruthy();
  });

  it("the time in my zone covers both dates when the event crosses midnight; no note for a broken date", async () => {
    await created();
    fireEvent.click(button(/More/));
    const zone = screen.getByText("Time zone").parentElement?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(zone, { target: { value: OTHER_ZONE } });
    type(screen.getByLabelText("End date"), "2026-11-13");
    expect(screen.getByText(/^Your time:/).textContent).toContain(" — ");
    type(screen.getByLabelText("Start date"), "");
    expect(screen.queryByText(/^Your time:/)).toBeNull();
  });
});
