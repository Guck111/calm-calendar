// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDraft } from "../shared/api/types";
import { setLang } from "../shared/i18n";
import { RepeatField } from "./RepeatField";

/** RRULE UNTIL of the end of this local day: "20261230T225959Z" in Warsaw */
const untilOf = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59).toISOString().replace(/[-:]|\.\d+/g, "");

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  setLang("ru");
});

// Wednesday, November 4, 2026, 10:00
const draft = (recurrence: string[] = [], over: Partial<EventDraft> = {}): EventDraft => ({
  calendarId: "c",
  title: "Standup",
  allDay: false,
  startDate: "2026-11-04",
  startTime: "10:00",
  endDate: "2026-11-04",
  endTime: "10:30",
  location: "",
  description: "",
  recurrence,
  ...over,
});

const show = (d: EventDraft, loading = false) => {
  const onChange = vi.fn();
  const view = render(<RepeatField draft={d} loading={loading} onChange={onChange} />);
  return { onChange, select: screen.getByRole("combobox", { name: "Repeat" }) as HTMLSelectElement, ...view };
};

describe("repeat field", () => {
  it("a one-off event shows 'Does not repeat' and offers presets from its start", () => {
    const { select } = show(draft());
    expect(select.value).toBe("none");
    const options = [...select.options].map((o) => o.text);
    expect(options).toEqual([
      "Does not repeat",
      "Daily",
      "Every weekday",
      "Weekly, on Wed",
      "Monthly, on day 4",
      "Monthly, on the first Wednesday",
      "Annually, on November 4",
      "Custom…",
    ]);
  });

  it("picking a preset writes its rule, picking 'Does not repeat' clears it", () => {
    const { select, onChange } = show(draft());
    fireEvent.change(select, { target: { value: "weekly" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
    fireEvent.change(select, { target: { value: "none" } });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps exception dates when the rule changes", () => {
    const { select, onChange } = show(draft(["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE:20261111T090000Z"]));
    expect(select.value).toBe("weekly");
    fireEvent.change(select, { target: { value: "daily" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=DAILY", "EXDATE:20261111T090000Z"]);
  });

  it("a rule the app can't edit is shown as set in Google and left alone", () => {
    const { select, onChange } = show(draft(["RRULE:FREQ=WEEKLY;BYSETPOS=2;BYDAY=MO,TU"]));
    expect(select.value).toBe("special");
    expect(screen.getByRole("option", { name: "Custom repeat set in Google" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("while the series rule loads the field waits", () => {
    const { select } = show(draft(), true);
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("loading");
  });

  it("an event without a valid start has no repeat field", () => {
    const { container } = render(<RepeatField draft={draft([], { startDate: "" })} loading={false} onChange={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("custom repeat", () => {
  const custom = (rule = "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE") => show(draft([rule]));

  it("a rule that isn't a preset opens the custom panel", () => {
    custom();
    expect(screen.getByRole("group", { name: "Days of the week" })).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Repeat every" }) as HTMLInputElement).value).toBe("2");
  });

  it("'Custom…' on a one-off event starts from weekly", () => {
    const { select, onChange } = show(draft());
    fireEvent.change(select, { target: { value: "custom" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
  });

  it("weekdays toggle, but the last one stays", () => {
    const { onChange, rerender } = custom("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
    fireEvent.click(screen.getByRole("button", { name: "Fri", pressed: false }));
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR"]);
    onChange.mockClear();
    rerender(<RepeatField draft={draft(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"])} loading={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wed", pressed: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a weekday can be taken off the list", () => {
    const { onChange } = custom();
    fireEvent.click(screen.getByRole("button", { name: "Mon", pressed: true }));
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"]);
  });

  it("days are only for weekly; going back to weekly starts from the event's day", () => {
    const { onChange, rerender } = custom();
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat period" }), { target: { value: "DAILY" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=DAILY;INTERVAL=2"]);
    rerender(<RepeatField draft={draft(["RRULE:FREQ=DAILY;INTERVAL=2"])} loading={false} onChange={onChange} />);
    expect(screen.queryByRole("group", { name: "Days of the week" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat period" }), { target: { value: "WEEKLY" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"]);
  });

  it("the end fields show the rule's own count and date", () => {
    const counted = custom("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=7");
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
    expect((screen.getByRole("spinbutton", { name: "After" }) as HTMLInputElement).value).toBe("7");
    fireEvent.click(radios[0]);
    expect(counted.onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"]);
    cleanup();
    custom(`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=${untilOf(2026, 11, 30)}`);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.checked)).toEqual([false, true, false]);
    expect((document.querySelector("input[type=date]") as HTMLInputElement).value).toBe("2026-12-30");
    cleanup();
    custom();
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.checked)).toEqual([true, false, false]);
    expect((document.querySelector("input[type=date]") as HTMLInputElement).value).toBe("2027-02-04");
  });

  it("the custom option names the rule while it's open", () => {
    const { select } = custom();
    expect(select.value).toBe("custom");
    expect(select.selectedOptions[0].text).toBe("Every 2 weeks, on Mon & Wed");
  });

  it("'Custom…' on a preset opens the panel without changing the rule; a Google-only rule stays put", () => {
    const { select, onChange } = show(draft(["RRULE:FREQ=DAILY"]));
    expect(screen.queryByRole("spinbutton", { name: "Repeat every" })).toBeNull();
    fireEvent.change(select, { target: { value: "custom" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(select.value).toBe("custom");
    expect(screen.getByRole("spinbutton", { name: "Repeat every" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "daily" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=DAILY"]);
    expect(screen.queryByRole("spinbutton", { name: "Repeat every" })).toBeNull();
    cleanup();
    const special = show(draft(["RRULE:FREQ=WEEKLY;BYSETPOS=2;BYDAY=MO,TU"]));
    fireEvent.change(special.select, { target: { value: "special" } });
    expect(special.onChange).not.toHaveBeenCalled();
  });

  it("the interval stays between 1 and 99", () => {
    const { onChange } = custom();
    const interval = screen.getByRole("spinbutton", { name: "Repeat every" });
    fireEvent.change(interval, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]);
    fireEvent.change(interval, { target: { value: "500" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=99;BYDAY=MO,WE"]);
  });

  it("the end can be a count of up to 999 or a date", () => {
    const { onChange } = custom();
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"]);
    fireEvent.change(screen.getByRole("spinbutton", { name: "After" }), { target: { value: "5000" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=999"]);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(onChange.mock.lastCall?.[0][0]).toBe(`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=${untilOf(2027, 1, 4)}`);
  });

  it("switching to monthly can repeat on the nth weekday", () => {
    const { onChange, rerender } = custom();
    const freq = screen.getByRole("combobox", { name: "Repeat period" });
    fireEvent.change(freq, { target: { value: "MONTHLY" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=MONTHLY;INTERVAL=2"]);
    rerender(<RepeatField draft={draft(["RRULE:FREQ=MONTHLY;INTERVAL=2"])} loading={false} onChange={onChange} />);
    const variant = screen.getByRole("combobox", { name: "Monthly on" }) as HTMLSelectElement;
    expect(variant.value).toBe("day");
    fireEvent.change(variant, { target: { value: "nth" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1WE"]);
    rerender(<RepeatField draft={draft(["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1WE"])} loading={false} onChange={onChange} />);
    const nth = screen.getByRole("combobox", { name: "Monthly on" }) as HTMLSelectElement;
    expect(nth.value).toBe("nth");
    fireEvent.change(nth, { target: { value: "day" } });
    expect(onChange).toHaveBeenLastCalledWith(["RRULE:FREQ=MONTHLY;INTERVAL=2"]);
  });
});

describe("names of the repeat lists", () => {
  it("a custom monthly rule has three lists, each with its own name for a screen reader", () => {
    show(draft(["RRULE:FREQ=MONTHLY;INTERVAL=2"]));
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat" }), { target: { value: "custom" } });
    const names = screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-label") ?? c.closest("label")?.firstChild?.textContent);
    expect(names).toEqual(["Repeat", "Repeat period", "Monthly on"]);
  });
});
