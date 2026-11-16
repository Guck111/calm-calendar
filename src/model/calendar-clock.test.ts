import { allSettled, fork } from "effector";
import { afterEach, expect, it, vi } from "vitest";
import { draftToBody, toCalendarEvent } from "../shared/api/calendar";
import { formatTime, toDateKey, toTimeKey, viewRange } from "../shared/lib/date";
import { overlapsDay } from "../shared/lib/layout";
import { wallClock } from "../shared/lib/tz";
import { applyChange, fromEvent } from "./editor";
import { $range, dateSelected, minuteTicked, viewChanged } from "./view";

afterEach(() => vi.unstubAllEnvs());

it("сохраняет оба момента второго часа при правке заголовка осеннего события", () => {
  const timeZone = "Europe/Warsaw";
  const event = toCalendarEvent("c", {
    id: "fall-back",
    summary: "До правки",
    start: { dateTime: "2026-10-25T02:30:00+01:00", timeZone },
    end: { dateTime: "2026-10-25T02:50:00+01:00", timeZone },
  });
  if (!event) throw new Error("Событие должно быть прочитано из Google");
  const body = draftToBody(applyChange(fromEvent(event), { title: "После правки" }));

  expect(body).toMatchObject({
    summary: "После правки",
    start: { dateTime: "2026-10-25T01:30:00.000Z", timeZone },
    end: { dateTime: "2026-10-25T01:50:00.000Z", timeZone },
  });
});

it("сохраняет часы UTC внутри отсутствующего локального часа", () => {
  vi.stubEnv("TZ", "Europe/Warsaw");
  const warsaw = toTimeKey(wallClock(new Date("2026-03-29T02:30:00Z"), "UTC"));
  vi.stubEnv("TZ", "America/New_York");
  const newYork = toTimeKey(wallClock(new Date("2026-03-08T02:30:00Z"), "UTC"));

  expect([warsaw, newYork]).toEqual(["02:30", "02:30"]);
});

it("пересчитывает выбранный день и формат времени после смены системного пояса", async () => {
  vi.stubEnv("TZ", "Europe/Warsaw");
  const scope = fork();
  const instant = new Date("2026-11-16T12:00:00Z");
  await allSettled(viewChanged, { scope, params: "day" });
  await allSettled(dateSelected, { scope, params: new Date(2026, 10, 16) });
  expect(formatTime(instant)).toBe("13:00");
  expect(scope.getState($range).start.toISOString()).toBe("2026-11-15T23:00:00.000Z");

  vi.stubEnv("TZ", "America/New_York");
  await allSettled(minuteTicked, { scope, params: instant });
  const { start, end } = scope.getState($range);

  expect({
    day: toDateKey(start),
    midnight: toTimeKey(start),
    start: start.toISOString(),
    end: end.toISOString(),
    formattedTime: formatTime(instant),
  }).toEqual({
    day: "2026-11-16",
    midnight: "00:00",
    start: "2026-11-16T05:00:00.000Z",
    end: "2026-11-17T05:00:00.000Z",
    formattedTime: "07:00",
  });
});

it("относит событие после полуночи в Гаване только к новому дню", () => {
  vi.stubEnv("TZ", "America/Havana");
  const march8 = new Date(2026, 2, 8);
  const march9 = new Date(2026, 2, 9);
  const event = toCalendarEvent("c", {
    id: "after-midnight",
    start: { dateTime: "2026-03-09T00:15:00-04:00" },
    end: { dateTime: "2026-03-09T00:30:00-04:00" },
  });
  if (!event) throw new Error("Событие должно быть прочитано из Google");

  expect({
    end: viewRange("day", march8).end.toISOString(),
    march8: overlapsDay(event, march8),
    march9: overlapsDay(event, march9),
  }).toEqual({
    end: "2026-03-09T04:00:00.000Z",
    march8: false,
    march9: true,
  });
});
