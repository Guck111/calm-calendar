// Hindi quick add: "कल शाम 7 बजे इंग्लिश क्लास 50 मिनट #निजी @ऑफिस".
import { makeIndicParser } from "./quick-indic";

const HOUR = "घंटे|घंटा|घंटों";

export const parseQuickHi = makeIndicParser({
  today: "आज",
  // «कल» — и вчера, и завтра; в календаре это завтра
  tomorrow: "कल",
  dayAfterTomorrow: "परसों",
  tonight: "आज\\s+(?:रात|शाम)(?:\\s+को)?",
  inDays: "(\\d+)\\s+दिन\\s+(?:बाद|में)",
  inWeeks: "(\\d+)\\s+(?:हफ़्ते|हफ्ते|हफ़्तों|हफ्तों|सप्ताह)\\s+(?:बाद|में)",
  months: [
    "जनवरी|jan",
    "फ़रवरी|फरवरी|feb",
    "मार्च|mar",
    "अप्रैल|apr",
    "मई|may",
    "जून|jun",
    "जुलाई|jul",
    "अगस्त|aug",
    "सितंबर|सितम्बर|sep",
    "अक्टूबर|अक्तूबर|oct",
    "नवंबर|नवम्बर|nov",
    "दिसंबर|दिसम्बर|dec",
  ],
  weekdays: ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार|बृहस्पतिवार|वीरवार", "शुक्रवार", "शनिवार", "रविवार|इतवार"],
  weekdaySuffix: "\\s+को",
  next: "अगले|अगला|आने\\s+वाले",
  am: "सुबह|सवेरे|प्रातः",
  pm: "दोपहर|शाम",
  night: "रात",
  hourWord: "बजे",
  half: "साढ़े",
  quarterPast: "सवा",
  quarterTo: "पौने",
  oneAndHalf: "डेढ़",
  twoAndHalf: "ढाई",
  from: "से",
  until: "तक",
  midnight: "आधी\\s+रात(?:\\s+को)?",
  minute: "मिनट",
  hour: HOUR,
  halfHour: "आधा\\s+घंटा|आधे\\s+घंटे",
  forWord: "के\\s+लिए",
  prepositions: "को|में|पर|से|तक|का|के|की|और",
});
