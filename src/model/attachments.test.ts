// Вложения события: чтение из Google, ссылка на файл Google Drive, сохранение при правке и разбиении серии
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../shared/api/types";

const googleRequest = vi.fn();
vi.mock(import("../shared/api/bridge"), async (importOriginal) => ({
  ...(await importOriginal()),
  googleRequest: (...args: unknown[]) => googleRequest(...args),
}));

const { draftToBody, planFollowing, saveEvent, toCalendarEvent } = await import("../shared/api/calendar");
const { applyChange, duplicateDraft, fromEvent } = await import("./editor");
const { parseDriveLink, MAX_ATTACHMENTS } = await import("../shared/lib/attachments");

beforeEach(() => {
  googleRequest.mockReset();
  googleRequest.mockResolvedValue({});
});

const ME = "me@example.com";
const CAL = `${ME}\u0000primary`;
const DOC = {
  fileUrl: "https://docs.google.com/document/d/1AbC_dEf/edit?usp=drive_web",
  title: "Повестка",
  mimeType: "application/vnd.google-apps.document",
  iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
  fileId: "1AbC_dEf",
};

const event = (over: Record<string, unknown> = {}): CalendarEvent =>
  toCalendarEvent(CAL, {
    id: "e1",
    summary: "Планёрка",
    start: { dateTime: "2026-11-12T10:00:00+01:00" },
    end: { dateTime: "2026-11-12T11:00:00+01:00" },
    organizer: { email: ME, self: true },
    attachments: [DOC],
    ...over,
  }) as CalendarEvent;

const call = (method: string) => googleRequest.mock.calls.find((c) => c[1] === method);

describe("ссылка на файл Google Drive", () => {
  it("документы, таблицы, презентации, формы и файлы Диска", () => {
    expect(parseDriveLink("https://docs.google.com/document/d/1AbC_dEf/edit?usp=sharing")).toEqual({
      fileUrl: "https://docs.google.com/document/d/1AbC_dEf/edit",
      title: "Google Docs",
      mimeType: "application/vnd.google-apps.document",
      fileId: "1AbC_dEf",
    });
    expect(parseDriveLink(" https://docs.google.com/spreadsheets/d/xyz-1/edit#gid=0 ")?.title).toBe("Google Sheets");
    expect(parseDriveLink("https://docs.google.com/presentation/d/p9/edit")?.title).toBe("Google Slides");
    expect(parseDriveLink("https://docs.google.com/forms/d/f1/edit")?.title).toBe("Google Forms");
    expect(parseDriveLink("https://drive.google.com/file/d/f2/view?usp=sharing")).toMatchObject({
      fileUrl: "https://drive.google.com/file/d/f2/view",
      fileId: "f2",
    });
    expect(parseDriveLink("https://drive.google.com/open?id=f3")?.fileId).toBe("f3");
  });

  it("другие ссылки Google не примет", () => {
    expect(parseDriveLink("https://example.com/report.pdf")).toBeNull();
    expect(parseDriveLink("http://docs.google.com/document/d/1/edit")).toBeNull();
    expect(parseDriveLink("https://drive.google.com/drive/folders/abc")).toBeNull();
    expect(parseDriveLink("not a link")).toBeNull();
  });

  it("у Google не больше 25 вложений", () => {
    expect(MAX_ATTACHMENTS).toBe(25);
  });
});

describe("вложения события", () => {
  it("читаются из Google", () => {
    expect(event().attachments).toEqual([{ fileUrl: DOC.fileUrl, title: "Повестка", mimeType: DOC.mimeType, fileId: DOC.fileId }]);
    expect(event({ attachments: undefined }).attachments).toBeUndefined();
  });

  it("новое вложение уходит в Google с supportsAttachments=true", async () => {
    const link = parseDriveLink("https://drive.google.com/file/d/f2/view")!;
    const draft = applyChange(fromEvent(event()), { attachments: [...(fromEvent(event()).attachments ?? []), link] });
    await saveEvent(draft);
    const [, , , query, body] = call("PATCH") ?? [];
    expect(query).toMatchObject({ supportsAttachments: "true" });
    expect(body.attachments.map((a: { fileUrl: string }) => a.fileUrl)).toEqual([DOC.fileUrl, link.fileUrl]);
  });

  it("убранное вложение исчезает из Google", () => {
    expect(draftToBody(applyChange(fromEvent(event()), { attachments: [] }))).toHaveProperty("attachments", []);
  });

  it("у чужой встречи вложения не трогаем", async () => {
    const theirs = event({ organizer: { email: "boss@example.com" } });
    expect(fromEvent(theirs).attachments).toBeUndefined();
    await saveEvent(fromEvent(theirs));
    expect(call("PATCH")?.[4]).not.toHaveProperty("attachments");
  });

  it("копия события уходит в Google вместе с вложениями, даже копия чужой встречи", async () => {
    const theirs = event({ organizer: { email: "boss@example.com" } });
    await saveEvent(duplicateDraft(theirs, [CAL]));
    const [, , , query, body] = call("POST") ?? [];
    expect(query).toMatchObject({ supportsAttachments: "true" });
    expect(body.attachments).toHaveLength(1);
  });

  it("новая серия «с этого и дальше» сохраняет вложения главного события", () => {
    const master = {
      id: "s",
      summary: "Планёрка",
      start: { dateTime: "2026-11-02T10:00:00+01:00" },
      end: { dateTime: "2026-11-02T11:00:00+01:00" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      attachments: [DOC],
    };
    const occurrence = event({
      id: "s_20261112T090000Z",
      recurringEventId: "s",
      originalStartTime: { dateTime: "2026-11-12T10:00:00+01:00" },
      attachments: undefined,
      organizer: { email: "boss@example.com" },
    });
    const plan = planFollowing({ ...fromEvent(occurrence, master.recurrence), title: "Новая" }, master, 0);
    expect(plan.kind).toBe("split");
    expect(plan.kind === "split" && plan.create.attachments).toEqual([DOC]);
  });
});
