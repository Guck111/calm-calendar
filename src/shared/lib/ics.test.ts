import { describe, expect, it } from "vitest";
import { expandIcs, parseDuration, parseIcs, zoneOf } from "./ics";

const CAL = "cal";
const ics = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Schedule", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

/** события в промежутке, как их увидит календарь */
const expand = (text: string, from: string, to: string) =>
  expandIcs(parseIcs(text), { start: new Date(from), end: new Date(to) }, CAL, "ics", "(untitled)");

const starts = (text: string, from: string, to: string) => expand(text, from, to).map((e) => e.start.toISOString());

describe("календарь .ics: разбор", () => {
  it("название календаря, событие с поясом, текст с переносами и экранированием", () => {
    const text = ics(
      vevent(
        "UID:1@x",
        'DTSTART;TZID="Europe/Berlin":20261111T090000',
        "DTEND;TZID=Europe/Berlin:20261111T103000",
        "SUMMARY:Team\\, weekly",
        "LOCATION:Room 4\\; floor 2",
        "DESCRIPTION:Line one\\nLine two",
      ),
    );
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(parseIcs(text).name).toBe("Schedule");
    expect(e.title).toBe("Team, weekly");
    expect(e.location).toBe("Room 4; floor 2");
    expect(e.description).toBe("Line one\nLine two");
    expect(e.start.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    expect(e.end.toISOString()).toBe("2026-11-11T09:30:00.000Z");
    expect(e.timeZone).toBe("Europe/Berlin");
    expect(e.allDay).toBe(false);
  });

  it("длинная строка, перенесённая пробелом, склеивается", () => {
    const text = ics(vevent("UID:2", "DTSTART:20261111T090000Z", "SUMMARY:A very long ti", " tle that was folded"));
    expect(expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z")[0].title).toBe("A very long title that was folded");
  });

  it("событие на весь день: конец не включительно, без DTEND — один день", () => {
    const text = ics(
      vevent("UID:3", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261113", "SUMMARY:Trip"),
      vevent("UID:4", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Holiday"),
    );
    const [trip, holiday] = expand(text, "2026-11-01T00:00:00", "2026-12-01T00:00:00");
    expect(trip.allDay).toBe(true);
    expect(trip.start).toEqual(new Date(2026, 10, 11));
    expect(trip.end).toEqual(new Date(2026, 10, 13));
    expect(holiday.end).toEqual(new Date(2026, 10, 21));
  });

  it("DURATION вместо DTEND", () => {
    const text = ics(vevent("UID:5", "DTSTART:20261111T090000Z", "DURATION:PT1H30M"));
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.end.toISOString()).toBe("2026-11-11T10:30:00.000Z");
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("-PT15M")).toBe(-15 * 60_000);
    expect(parseDuration("P")).toBeNull();
  });

  it("пояса Outlook (Windows) и с префиксом узнаются, неизвестный пояс — по часам компьютера", () => {
    expect(zoneOf("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(zoneOf("/mozilla.org/20050126_1/Europe/Paris")).toBe("Europe/Paris");
    expect(zoneOf("Mars Standard Time")).toBeUndefined();
    const text = ics(vevent("UID:6", "DTSTART;TZID=Mars Standard Time:20261111T090000"));
    const [e] = expand(text, "2026-11-10T00:00:00", "2026-11-13T00:00:00");
    expect(e.start).toEqual(new Date(2026, 10, 11, 9, 0));
  });

  it("отменённые события и напоминания внутри события не мешают", () => {
    const text = ics(
      vevent("UID:7", "DTSTART:20261111T090000Z", "STATUS:CANCELLED", "SUMMARY:Gone"),
      vevent("UID:8", "DTSTART:20261111T100000Z", "SUMMARY:Kept", "BEGIN:VALARM", "TRIGGER:-PT15M", "SUMMARY:Alarm", "END:VALARM"),
    );
    expect(expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z").map((e) => e.title)).toEqual(["Kept"]);
  });

  it("свободное время, ссылка на видеовстречу в описании, событие без названия", () => {
    const text = ics(
      vevent("UID:9", "DTSTART:20261111T090000Z", "TRANSP:TRANSPARENT", "DESCRIPTION:Join https://zoom.us/j/123"),
    );
    const [e] = expand(text, "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.free).toBe(true);
    expect(e.meeting?.url).toBe("https://zoom.us/j/123");
    expect(e.title).toBe("(untitled)");
  });

  it("мусор вместо календаря — пустой список, а не ошибка", () => {
    expect(parseIcs("<html>Not found</html>").events).toEqual([]);
  });
});

describe("календарь .ics: повторы", () => {
  it("каждую неделю по вторникам и четвергам, пока не кончится COUNT", () => {
    const text = ics(vevent("UID:w", "DTSTART:20261110T170000Z", "DURATION:PT1H", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z")).toEqual([
      "2026-11-10T17:00:00.000Z",
      "2026-11-12T17:00:00.000Z",
      "2026-11-17T17:00:00.000Z",
      "2026-11-19T17:00:00.000Z",
    ]);
  });

  it("через неделю: INTERVAL", () => {
    const text = ics(vevent("UID:i", "DTSTART:20261102T080000Z", "RRULE:FREQ=WEEKLY;INTERVAL=2"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-16T08:00:00.000Z",
      "2026-11-30T08:00:00.000Z",
    ]);
  });

  it("второй вторник и последняя пятница месяца", () => {
    const second = ics(vevent("UID:m", "DTSTART:20261110T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU"));
    expect(starts(second, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual([
      "2026-11-10T09:00:00.000Z",
      "2026-12-08T09:00:00.000Z",
      "2027-01-12T09:00:00.000Z",
    ]);
    const last = ics(vevent("UID:l", "DTSTART:20261127T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"));
    expect(starts(last, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual([
      "2026-11-27T09:00:00.000Z",
      "2026-12-25T09:00:00.000Z",
      "2027-01-29T09:00:00.000Z",
    ]);
  });

  it("последнее число месяца и день рождения раз в год", () => {
    const monthEnd = ics(vevent("UID:e", "DTSTART;VALUE=DATE:20261130", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"));
    expect(expand(monthEnd, "2026-11-01T00:00:00", "2027-03-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 10, 30),
      new Date(2026, 11, 31),
      new Date(2027, 0, 31),
      new Date(2027, 1, 28),
    ]);
    const birthday = ics(vevent("UID:b", "DTSTART;VALUE=DATE:19900315", "RRULE:FREQ=YEARLY"));
    expect(expand(birthday, "2026-01-01T00:00:00", "2028-01-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 2, 15),
      new Date(2027, 2, 15),
    ]);
  });

  it("UNTIL включает последний день, EXDATE убирает повторение", () => {
    const text = ics(
      vevent(
        "UID:u",
        "DTSTART;TZID=Europe/Warsaw:20261109T090000",
        "RRULE:FREQ=DAILY;UNTIL=20261113T080000Z",
        "EXDATE;TZID=Europe/Warsaw:20261111T090000",
      ),
    );
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-09T08:00:00.000Z",
      "2026-11-10T08:00:00.000Z",
      "2026-11-12T08:00:00.000Z",
      "2026-11-13T08:00:00.000Z",
    ]);
  });

  it("время по часам пояса сохраняется при переходе на зимнее время", () => {
    const text = ics(vevent("UID:dst", "DTSTART;TZID=Europe/Berlin:20261023T090000", "RRULE:FREQ=WEEKLY"));
    expect(starts(text, "2026-10-20T00:00:00Z", "2026-11-05T00:00:00Z")).toEqual([
      "2026-10-23T07:00:00.000Z",
      "2026-10-30T08:00:00.000Z",
    ]);
  });

  it("перенесённое повторение показывается на новом месте, а не на старом", () => {
    const text = ics(
      vevent("UID:r", "DTSTART:20261109T090000Z", "SUMMARY:Standup", "RRULE:FREQ=DAILY;COUNT=3"),
      vevent("UID:r", "RECURRENCE-ID:20261110T090000Z", "DTSTART:20261110T150000Z", "SUMMARY:Standup (moved)"),
    );
    expect(expand(text, "2026-11-09T00:00:00Z", "2026-11-12T00:00:00Z").map((e) => `${e.title} ${e.start.toISOString()}`)).toEqual([
      "Standup 2026-11-09T09:00:00.000Z",
      "Standup (moved) 2026-11-10T15:00:00.000Z",
      "Standup 2026-11-11T09:00:00.000Z",
    ]);
  });

  it("RDATE добавляет дни вне правила, а повтор того же дня не дублирует", () => {
    const text = ics(
      vevent("UID:rd", "DTSTART:20261102T090000Z", "RRULE:FREQ=WEEKLY;COUNT=2", "RDATE:20261105T090000Z,20261109T090000Z"),
    );
    expect(starts(text, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
  });

  it("BYMONTH: последнее воскресенье марта и октября (переход часов в Европе)", () => {
    const text = ics(vevent("UID:bm", "DTSTART;VALUE=DATE:20260329", "RRULE:FREQ=YEARLY;BYMONTH=3,10;BYDAY=-1SU"));
    expect(expand(text, "2026-01-01T00:00:00", "2028-01-01T00:00:00").map((e) => e.start)).toEqual([
      new Date(2026, 2, 29),
      new Date(2026, 9, 25),
      new Date(2027, 2, 28),
      new Date(2027, 9, 31),
    ]);
  });

  it("давняя бесконечная серия раскладывается только на показанные дни", () => {
    const text = ics(vevent("UID:old", "DTSTART:20050103T090000Z", "RRULE:FREQ=DAILY"));
    expect(starts(text, "2026-11-11T00:00:00Z", "2026-11-13T00:00:00Z")).toEqual([
      "2026-11-11T09:00:00.000Z",
      "2026-11-12T09:00:00.000Z",
    ]);
  });

  it("правило, которое мы не умеем раскладывать, оставляет только первое событие", () => {
    const text = ics(vevent("UID:p", "DTSTART:20261102T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"));
    expect(starts(text, "2026-11-01T00:00:00Z", "2027-02-01T00:00:00Z")).toEqual(["2026-11-02T09:00:00.000Z"]);
  });

  it("события из подписки только для чтения и без связи с Google", () => {
    const [e] = expand(ics(vevent("UID:z", "DTSTART:20261111T090000Z")), "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z");
    expect(e.calendarId).toBe(CAL);
    expect(e.recurring).toBe(false);
    expect(e.organizerSelf).toBe(false);
    expect(e.htmlLink).toBeUndefined();
  });
});
