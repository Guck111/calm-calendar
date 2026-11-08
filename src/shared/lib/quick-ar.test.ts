import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// الأربعاء 4 نوفمبر 2026، 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "شخصي" },
  { id: "work", name: "العمل" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const ar = (text: string) => parseQuick(text, now, calendars, "ar");

describe("quick add in Arabic", () => {
  it("غدًا، الوقت والمدة", () => {
    expect(ar("غدًا الساعة 7 مساءً درس إنجليزي 50 دقيقة")).toMatchObject({
      title: "درس إنجليزي",
      allDay: false,
      start: at(5, 19),
      end: at(5, 19, 50),
    });
    expect(ar("اجتماع غدا الساعة 9 صباحا #العمل @المكتب_الرئيسي نصف ساعة")).toMatchObject({
      title: "اجتماع",
      calendarId: "work",
      location: "المكتب الرئيسي",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("الأرقام العربية والفترات", () => {
    expect(ar("غداً الساعة ٧:٣٠ م عشاء")).toMatchObject({ title: "عشاء", start: at(5, 19, 30) });
    expect(ar("مكالمة من 2 إلى 3:30 مساءً يوم الجمعة")).toMatchObject({ title: "مكالمة", start: at(6, 14), end: at(6, 15, 30) });
    expect(ar("اليوم 19:00-20:30 يوغا").end).toEqual(at(4, 20, 30));
    expect(ar("الليلة الساعة 8 فيلم")).toMatchObject({ title: "فيلم", start: at(4, 20) });
  });

  it("أيام الأسبوع: الأقرب، و«القادم» يتخطى اليوم", () => {
    expect(ar("الأربعاء 20:00 تمرين").start).toEqual(at(4, 20));
    expect(ar("الأربعاء القادم مراجعة")).toMatchObject({ title: "مراجعة", allDay: true, start: at(11, 0) });
    expect(ar("يوم السبت عيد ميلاد سارة")).toMatchObject({ title: "عيد ميلاد سارة", allDay: true, start: at(7, 0) });
  });

  it("التواريخ؛ التاريخ الماضي بلا سنة يكون في العام القادم", () => {
    expect(ar("5 ديسمبر الساعة 10 طبيب الأسنان").start).toEqual(at(5, 10, 0, 11));
    expect(ar("5 كانون الأول الساعة 10 طبيب").start).toEqual(at(5, 10, 0, 11));
    expect(ar("12/11 حلاق")).toMatchObject({ title: "حلاق", allDay: true, start: at(12, 0) });
    expect(ar("1 مارس إجازة").start).toEqual(new Date(2027, 2, 1));
    expect(ar("بعد 3 أيام الساعة 12 غداء").start).toEqual(at(7, 12));
    expect(ar("بعد غد 10:00 البنك").start).toEqual(at(6, 10));
  });

  it("المثنى والمدة", () => {
    expect(ar("بعد يومين الساعة 9 صباحا موعد").start).toEqual(at(6, 9));
    expect(ar("الجمعة 18 سينما ساعتين")).toMatchObject({ title: "سينما", start: at(6, 18), end: at(6, 20) });
    expect(ar("غدا لمدة ساعتين تنظيف")).toMatchObject({ title: "تنظيف", allDay: true });
  });

  it("لا يغيّر الأرقام في العنوان", () => {
    expect(ar("شراء 2 تذاكر")).toMatchObject({ title: "شراء 2 تذاكر", allDay: true });
    // «غداء» (обед) — не «غدا» (завтра)
    expect(ar("بعد 3 أيام غداء")).toMatchObject({ title: "غداء", start: at(7, 0) });
  });
});
