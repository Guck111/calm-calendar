import { describe, expect, it } from "vitest";
import { parseQuick } from "./quick";

// 2026年11月4日 星期三 18:00
const now = new Date(2026, 10, 4, 18, 0);
const calendars = [
  { id: "me", name: "个人" },
  { id: "work", name: "工作" },
];
const at = (d: number, h: number, m = 0, month = 10) => new Date(2026, month, d, h, m);
const zh = (text: string) => parseQuick(text, now, calendars, "zh");

describe("quick add in Chinese", () => {
  it("明天、时间和时长", () => {
    expect(zh("明天下午3点 英语课 50分钟")).toMatchObject({ title: "英语课", allDay: false, start: at(5, 15), end: at(5, 15, 50) });
    expect(zh("明天上午9点 开会 #工作 @星巴克 半小时")).toMatchObject({
      title: "开会",
      calendarId: "work",
      location: "星巴克",
      start: at(5, 9),
      end: at(5, 9, 30),
    });
  });

  it("连写和汉字数字", () => {
    expect(zh("明天下午三点开会")).toMatchObject({ title: "开会", start: at(5, 15), end: at(5, 16) });
    expect(zh("周五晚上七点半吃饭")).toMatchObject({ title: "吃饭", start: at(6, 19, 30) });
    expect(zh("明天十点 打扫 一个半小时")).toMatchObject({ title: "打扫", start: at(5, 10), end: at(5, 11, 30) });
    expect(zh("后天两点 银行").start).toEqual(at(6, 2));
  });

  it("时段和时间范围", () => {
    expect(zh("下午2点到4点 培训")).toMatchObject({ title: "培训", start: at(5, 14), end: at(5, 16) });
    expect(zh("今天19:00-20:30 瑜伽").end).toEqual(at(4, 20, 30));
    expect(zh("今晚8点 看电影")).toMatchObject({ title: "看电影", start: at(4, 20) });
    expect(zh("明天10点15分 看牙").start).toEqual(at(5, 10, 15));
  });

  it("星期：最近的一天，下周是下一周", () => {
    expect(zh("星期三 20点 训练").start).toEqual(at(4, 20));
    expect(zh("下周三 复盘")).toMatchObject({ title: "复盘", allDay: true, start: at(11, 0) });
    expect(zh("下周一 例会").start).toEqual(at(9, 0));
    expect(zh("周六 朋友生日")).toMatchObject({ title: "朋友生日", allDay: true, start: at(7, 0) });
    expect(zh("禮拜天 爬山").start).toEqual(at(8, 0));
  });

  it("日期：已过的日期算明年", () => {
    expect(zh("12月5号 10点 看医生").start).toEqual(at(5, 10, 0, 11));
    expect(zh("11/12 理发")).toMatchObject({ title: "理发", allDay: true, start: at(12, 0) });
    expect(zh("3月1日 休假")).toMatchObject({ title: "休假", start: new Date(2027, 2, 1) });
    expect(zh("3天后 12点 午饭").start).toEqual(at(7, 12));
    expect(zh("两个星期后 复查").start).toEqual(at(18, 0));
    expect(zh("20号 交房租").start).toEqual(at(20, 0));
  });

  it("标题里的数字和介词保持原样", () => {
    expect(zh("买2张票")).toMatchObject({ title: "买2张票", allDay: true });
    expect(zh("明天在家办公")).toMatchObject({ title: "在家办公", allDay: true, start: at(5, 0) });
  });
});
