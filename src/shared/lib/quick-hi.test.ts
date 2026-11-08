import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// बुधवार, 4 नवंबर 2026, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "निजी" },
  { id: "work", name: "काम" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const hi = (text: string) => parseQuick(text, now, calendars, "hi");

describe("quick add in Hindi", () => {
  it("कल, समय और अवधि", () => {
    expect(hi("कल शाम 7 बजे इंग्लिश क्लास 50 मिनट")).toMatchObject({
      title: "इंग्लिश क्लास",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(hi("कल सुबह 9 बजे मीटिंग #काम @मुख्य_ऑफिस आधा घंटा")).toMatchObject({
      title: "मीटिंग",
      calendarId: "work",
      location: "मुख्य ऑफिस",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("दिन का हिस्सा, रात और देवनागरी अंक", () => {
    expect(hi("शुक्रवार को रात 9 बजे डिनर")).toMatchObject({ title: "डिनर", start: at(6, 21) });
    expect(hi("कल रात 2 बजे फ्लाइट").start).toEqual(at(5, 2));
    expect(hi("कल दोपहर २ बजे लंच").start).toEqual(at(5, 14));
    expect(hi("आज रात 8 बजे फिल्म")).toMatchObject({ title: "फिल्म", start: at(4, 20) });
  });

  it("साढ़े, सवा, पौने और समय की अवधि", () => {
    expect(hi("कल साढ़े 10 बजे डॉक्टर")).toMatchObject({ title: "डॉक्टर", start: at(5, 10, 30) });
    expect(hi("कल सवा 9 बजे बस").start).toEqual(at(5, 9, 15));
    expect(hi("कल पौने 8 बजे ट्रेन").start).toEqual(at(5, 7, 45));
    expect(hi("शाम 7 से 9 बजे तक पार्टी")).toMatchObject({ title: "पार्टी", start: at(4, 19), end: at(4, 21) });
    expect(hi("आज 19:00-20:30 योग").end).toEqual(at(4, 20, 30));
  });

  it("हफ़्ते के दिन: सबसे पास वाला, अगले से आज छूटता है", () => {
    expect(hi("बुधवार 20:00 ट्रेनिंग").start).toEqual(at(4, 20));
    expect(hi("अगले बुधवार रिव्यू")).toMatchObject({ title: "रिव्यू", allDay: true, start: at(11, 0) });
    expect(hi("शनिवार दोस्त का जन्मदिन")).toMatchObject({ title: "दोस्त का जन्मदिन", allDay: true, start: at(7, 0) });
  });

  it("तारीखें; बीती तारीख अगले साल की", () => {
    expect(hi("5 दिसंबर सुबह 10 बजे डेंटिस्ट").start).toEqual(at(5, 10, 0, 11));
    expect(hi("12/11 बाल कटवाना")).toMatchObject({ title: "बाल कटवाना", allDay: true, start: at(12, 0) });
    expect(hi("1 मार्च छुट्टी")).toMatchObject({ title: "छुट्टी", start: new Date(2027, 2, 1) });
    expect(hi("3 दिन बाद दोपहर 12 बजे लंच").start).toEqual(at(7, 12));
    expect(hi("परसों 10:00 बैंक").start).toEqual(at(6, 10));
    expect(hi("5 Dec meeting").start).toEqual(at(5, 0, 0, 11));
  });

  it("अवधि और शीर्षक के अंक", () => {
    expect(hi("कल 10 बजे सफाई डेढ़ घंटा")).toMatchObject({ title: "सफाई", start: at(5, 10), end: at(5, 11, 30) });
    expect(hi("कल 2 घंटे सफाई")).toMatchObject({ title: "सफाई", allDay: true });
    expect(hi("2 से 3 लोग आएंगे")).toMatchObject({ title: "2 से 3 लोग आएंगे", allDay: true });
    expect(hi("2 टिकट खरीदना")).toMatchObject({ title: "2 टिकट खरीदना", allDay: true });
  });
});
