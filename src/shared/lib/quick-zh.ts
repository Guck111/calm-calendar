// Chinese quick add (simplified and traditional): "明天下午3点 英语课 50分钟 #个人 @星巴克".
import { makeCjkParser } from "./quick-cjk";

const WEEK = "(?:星期|周|週|礼拜|禮拜)";
const AFTER = "(?:以?后|以?後|之后|之後)";

export const parseQuickZh = makeCjkParser({
  today: "今天|今日",
  tomorrow: "明天|明日",
  dayAfterTomorrow: "后天|後天",
  tonight: "今晚|今天晚上|今夜",
  inDays: `(\\d+)\\s*天${AFTER}`,
  inWeeks: `(\\d+)\\s*(?:个|個)?${WEEK}${AFTER}`,
  daySuffix: "日|号|號",
  // «这周五», «本周五» — ближайшая пятница; «下周五» — пятница следующей недели
  weekday: `(下(?:个|個)?)?(?:这|這|本)?${WEEK}([一二三四五六日天])`,
  weekdayChars: ["一", "二", "三", "四", "五", "六", "[日天]"],
  hour: "点钟?|點鐘?|时|時",
  am: "上午|早上|早晨|凌晨|清晨",
  pm: "下午|晚上|傍晚|中午|夜里|夜裡",
  noon: "正午",
  rangeSep: "-|–|—|~|～|〜|到|至",
  durMinute: "分钟|分鐘",
  durHour: "(?:个|個)?(?:小时|小時|钟头|鐘頭)",
  halfHour: "半(?:个|個)?(?:小时|小時|钟头|鐘頭)",
  hourAndHalf: "(\\d+)\\s*(?:个|個)半(?:小时|小時|钟头|鐘頭)",
  particles: "在|于|於|的|从|從|到|，|、",
});
