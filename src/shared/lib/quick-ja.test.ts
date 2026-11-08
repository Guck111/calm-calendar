import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// 2026年11月4日（水）18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "個人" },
  { id: "work", name: "仕事" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const ja = (text: string) => parseQuick(text, now, calendars, "ja");

describe("quick add in Japanese", () => {
  it("明日、時刻、長さ", () => {
    expect(ja("明日19時 英会話 50分")).toMatchObject({ title: "英会話", allDay: false, start: at(5, 19), end: at(5, 19, 50) });
    expect(ja("明日9時に打ち合わせ #仕事 @渋谷オフィス 30分")).toMatchObject({
      title: "打ち合わせ",
      calendarId: "work",
      location: "渋谷オフィス",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("書き方がつながっていても読む", () => {
    expect(ja("明日午後3時から会議")).toMatchObject({ title: "会議", start: at(5, 15), end: at(5, 16) });
    expect(ja("金曜日の夜7時半にディナー")).toMatchObject({ title: "ディナー", start: at(6, 19, 30) });
  });

  it("時間帯と範囲", () => {
    expect(ja("午後2時から4時まで研修")).toMatchObject({ title: "研修", start: at(5, 14), end: at(5, 16) });
    expect(ja("今日19:00-20:30 ヨガ").end).toEqual(at(4, 20, 30));
    expect(ja("今夜8時 映画")).toMatchObject({ title: "映画", start: at(4, 20) });
    expect(ja("明日10時15分 歯医者").start).toEqual(at(5, 10, 15));
  });

  it("曜日：いちばん近い日、来週は次の週", () => {
    expect(ja("水曜 20時 トレーニング").start).toEqual(at(4, 20));
    expect(ja("来週の水曜日 レビュー")).toMatchObject({ title: "レビュー", allDay: true, start: at(11, 0) });
    expect(ja("来週の月曜 定例").start).toEqual(at(9, 0));
    expect(ja("土曜日 友達の誕生日")).toMatchObject({ title: "友達の誕生日", allDay: true, start: at(7, 0) });
  });

  it("日付：過ぎた日付は来年", () => {
    expect(ja("12月5日 10時 病院").start).toEqual(at(5, 10, 0, 11));
    expect(ja("11/12 美容院")).toMatchObject({ title: "美容院", allDay: true, start: at(12, 0) });
    expect(ja("3月1日から休暇")).toMatchObject({ title: "休暇", start: new Date(2027, 2, 1) });
    expect(ja("3日後 12時 ランチ").start).toEqual(at(7, 12));
    expect(ja("あさって10時 銀行").start).toEqual(at(6, 10));
    expect(ja("20日 支払い").start).toEqual(at(20, 0));
  });

  it("漢数字と長さ", () => {
    expect(ja("明日三時 お茶")).toMatchObject({ title: "お茶", start: at(5, 3) });
    expect(ja("金曜18時 映画 2時間")).toMatchObject({ title: "映画", start: at(6, 18), end: at(6, 20) });
    expect(ja("明日10時 掃除 1時間半").end).toEqual(at(5, 11, 30));
  });

  it("タイトルの数字はそのまま", () => {
    expect(ja("チケットを2枚買う")).toMatchObject({ title: "チケットを2枚買う", allDay: true });
  });
});
