// Japanese quick add: "明日19時 英会話 50分 #個人 @渋谷".
import { makeCjkParser } from "./quick-cjk";

export const parseQuickJa = makeCjkParser({
  today: "今日|きょう|本日",
  tomorrow: "明日|あした|あす",
  dayAfterTomorrow: "明後日|あさって",
  tonight: "今夜|今晩|今日の夜",
  inDays: "(\\d+)\\s*日後",
  inWeeks: "(\\d+)\\s*週間後",
  daySuffix: "日",
  weekday: "(来週の?)?([月火水木金土日])曜日?",
  weekdayChars: ["月", "火", "水", "木", "金", "土", "日"],
  hour: "時",
  am: "午前|朝",
  pm: "午後|夕方|夜",
  noon: "正午",
  rangeSep: "-|–|—|~|〜|から",
  rangeEnd: "まで",
  durMinute: "分間?",
  durHour: "時間",
  halfHour: "半時間|30分間",
  hourAndHalf: "(\\d+)\\s*時間半",
  particles: "に|で|から|まで|の|は|を|と|、",
  edgeParticles: "に|で|から|まで|の|は|を|、",
});
