import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// বুধবার, ৪ নভেম্বর ২০২৬, 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "ব্যক্তিগত" },
  { id: "work", name: "কাজ" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const bn = (text: string) => parseQuick(text, now, calendars, "bn");
// «য়» и «ড়» бывают одним знаком и двумя: сравниваем в одной форме
const nfc = (s: string) => s.normalize("NFC");

describe("quick add in Bengali", () => {
  it("কাল, সময় ও সময়কাল", () => {
    expect(bn("কাল সন্ধ্যা 7টায় ইংরেজি ক্লাস 50 মিনিট")).toMatchObject({
      title: "ইংরেজি ক্লাস",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(bn("কাল সকাল ৯টায় মিটিং #কাজ @প্রধান_অফিস আধা ঘণ্টা")).toMatchObject({
      title: "মিটিং",
      calendarId: "work",
      location: "প্রধান অফিস",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("দিনের ভাগ, রাত ও বাংলা অঙ্ক", () => {
    expect(bn("শুক্রবারে রাত 9টায় ডিনার")).toMatchObject({ title: "ডিনার", start: at(6, 21) });
    expect(bn("কাল রাত ২টায় ফ্লাইট").start).toEqual(at(5, 2));
    expect(bn("কাল দুপুর ২টায় লাঞ্চ").start).toEqual(at(5, 14));
    expect(bn("আজ রাতে 8টায় সিনেমা")).toMatchObject({ title: "সিনেমা", start: at(4, 20) });
    expect(bn("কাল সকালে 7টা বাজে হাঁটা").start).toEqual(at(5, 7));
  });

  it("সাড়ে, সোয়া, পৌনে ও সময়ের পরিসর", () => {
    expect(bn("কাল সাড়ে 10টায় ডাক্তার")).toMatchObject({ title: nfc("ডাক্তার"), start: at(5, 10, 30) });
    expect(bn("কাল সোয়া 9টায় বাস").start).toEqual(at(5, 9, 15));
    expect(bn("কাল পৌনে 8টায় ট্রেন").start).toEqual(at(5, 7, 45));
    expect(bn("সন্ধ্যা 7টা থেকে 9টা পর্যন্ত পার্টি")).toMatchObject({ title: "পার্টি", start: at(4, 19), end: at(4, 21) });
    expect(bn("আজ 19:00-20:30 যোগব্যায়াম").end).toEqual(at(4, 20, 30));
  });

  it("সপ্তাহের দিন: সবচেয়ে কাছেরটি, আগামী মানে আজ নয়", () => {
    expect(bn("বুধবার 20:00 ট্রেনিং").start).toEqual(at(4, 20));
    expect(bn("আগামী বুধবার রিভিউ")).toMatchObject({ title: "রিভিউ", allDay: true, start: at(11, 0) });
    expect(bn("শনিবার বন্ধুর জন্মদিন")).toMatchObject({ title: "বন্ধুর জন্মদিন", allDay: true, start: at(7, 0) });
  });

  it("তারিখ; পেরিয়ে যাওয়া তারিখ পরের বছরের", () => {
    expect(bn("৫ই ডিসেম্বর সকাল 10টায় ডেন্টিস্ট").start).toEqual(at(5, 10, 0, 11));
    expect(bn("12/11 চুল কাটা")).toMatchObject({ title: "চুল কাটা", allDay: true, start: at(12, 0) });
    expect(bn("১লা মার্চ ছুটি")).toMatchObject({ title: "ছুটি", start: new Date(2027, 2, 1) });
    expect(bn("3 দিন পরে দুপুর 12টায় লাঞ্চ").start).toEqual(at(7, 12));
    expect(bn("পরশু 10:00 ব্যাংক").start).toEqual(at(6, 10));
  });

  it("সময়কাল ও শিরোনামের সংখ্যা", () => {
    expect(bn("কাল 10টায় পরিষ্কার দেড় ঘণ্টা")).toMatchObject({ title: "পরিষ্কার", start: at(5, 10), end: at(5, 11, 30) });
    expect(bn("কাল 2 ঘণ্টা পরিষ্কার")).toMatchObject({ title: "পরিষ্কার", allDay: true });
    expect(bn("সকালের নাস্তা")).toMatchObject({ title: "সকালের নাস্তা", allDay: true, start: at(4, 0) });
    expect(bn("2 টিকিট কেনা")).toMatchObject({ title: "2 টিকিট কেনা", allDay: true });
  });
});
