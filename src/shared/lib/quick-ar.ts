// Arabic quick add: "غدًا الساعة 7 مساءً درس إنجليزي 50 دقيقة #شخصي @المكتب".
import type { QuickCalendar, QuickResult } from "./quick-core";
import { makeEuParser } from "./quick-eu";

/** «مساءً» пишут и «مساءً», и «مساءا», и «مساء»; танвин — отдельный знак */
const TANWEEN = "(?:اً|ًا|ا|ً)?";
const GHADAN = `غد${TANWEEN}|بكر[ةه]`;

const parse = makeEuParser({
  today: "اليوم",
  tomorrow: GHADAN,
  dayAfterTomorrow: `بعد\\s+(?:${GHADAN})`,
  tonight: "الليلة|هذا\\s+المساء|اليوم\\s+(?:مساء|بالليل)" + TANWEEN,
  inN: "بعد|خلال",
  dayUnit: "أيام|ايام|يوم[اً]*",
  weekUnit: "أسابيع|اسابيع|أسبوع|اسبوع",
  months: [
    "يناير|كانون\\s+الثاني",
    "فبراير|شباط",
    "مارس|آذار|اذار",
    "أبريل|ابريل|نيسان",
    "مايو|أيار|ايار",
    "يونيو|يونيه|حزيران",
    "يوليو|يوليه|تموز",
    "أغسطس|اغسطس|آب",
    "سبتمبر|أيلول|ايلول",
    "أكتوبر|اكتوبر|تشرين\\s+الأول|تشرين\\s+الاول",
    "نوفمبر|تشرين\\s+الثاني",
    "ديسمبر|كانون\\s+الأول|كانون\\s+الاول",
  ],
  numericDate: "slash",
  weekdays: ["ال[اإأ]?ثنين", "الثلاثاء", "ال[أا]ربعاء", "الخميس", "الجمعة", "السبت", "ال[أا]حد"],
  on: "يوم",
  nextAfter: "القادم|المقبل|الجاي",
  at: "الساعة|الساعه|ساعة",
  from: "من",
  to: "إلى|الى|حتى|لل?",
  hourWord: "(?!)",
  am: `صباح${TANWEEN}|الصبح|ص`,
  pm: `مساء${TANWEEN}|ظهر${TANWEEN}|عصر${TANWEEN}|ليل${TANWEEN}|بالليل|م`,
  noon: "الظهر|منتصف\\s+النهار",
  midnight: "منتصف\\s+الليل",
  forWord: "لمدة|مدة",
  minute: "دقيقة|دقائق|دقيقه|د",
  hour: "ساعة|ساعات|ساعه|س",
  halfHour: "نصف\\s+ساعة|نص\\s+ساعة|نصف\\s+ساعه",
  atText: "الساعة",
  prepositions: "في|يوم|الساعة|من|إلى|الى|على|عند|لمدة",
});

// двойственное число без цифры: «ساعتين» — 2 часа, «يومين» — 2 дня
const DUALS: [RegExp, string][] = [
  [/(?<![\p{L}\p{M}])ساعت(?:ين|ان)(?![\p{L}\p{M}])/gu, "2 ساعة"],
  [/(?<![\p{L}\p{M}])دقيقت(?:ين|ان)(?![\p{L}\p{M}])/gu, "2 دقيقة"],
  [/(?<![\p{L}\p{M}])يوم(?:ين|ان)(?![\p{L}\p{M}])/gu, "2 يوم"],
  [/(?<![\p{L}\p{M}])[أا]سبوع(?:ين|ان)(?![\p{L}\p{M}])/gu, "2 أسبوع"],
];

export const parseQuickAr = (input: string, now: Date, calendars: QuickCalendar[]): QuickResult =>
  parse(
    DUALS.reduce((s, [r, to]) => s.replace(r, to), input),
    now,
    calendars,
  );
