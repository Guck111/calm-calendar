// Вложения события в Google Календаре — это файлы Google Диска. С правом calendar.events можно прикрепить
// файл по ссылке на него; загрузить файл с компьютера — только с правом Диска (этап 3б).
import type { Attachment } from "../api/types";

/** больше Google не принимает */
export const MAX_ATTACHMENTS = 25;

const DOCS: Record<string, { title: string; mimeType: string }> = {
  document: { title: "Google Docs", mimeType: "application/vnd.google-apps.document" },
  spreadsheets: { title: "Google Sheets", mimeType: "application/vnd.google-apps.spreadsheet" },
  presentation: { title: "Google Slides", mimeType: "application/vnd.google-apps.presentation" },
  forms: { title: "Google Forms", mimeType: "application/vnd.google-apps.form" },
};

const ID = "[\\w-]+";
const DOC_LINK = new RegExp(`^https://docs\\.google\\.com/(document|spreadsheets|presentation|forms)/d/(${ID})`);
const FILE_LINK = new RegExp(`^https://drive\\.google\\.com/file/d/(${ID})`);
const OPEN_LINK = new RegExp(`^https://drive\\.google\\.com/open\\?(?:.*&)?id=(${ID})`);

/** Ссылка на файл Google Диска → вложение. Название пока условное («Google Docs»): настоящее имя файла
 *  знает только Диск. Не ссылка на файл Диска — null */
export const parseDriveLink = (text: string): Attachment | null => {
  const url = text.trim();
  const doc = DOC_LINK.exec(url);
  if (doc) {
    const [, kind, fileId] = doc;
    return { fileUrl: `https://docs.google.com/${kind}/d/${fileId}/edit`, ...DOCS[kind], fileId };
  }
  const file = FILE_LINK.exec(url) ?? OPEN_LINK.exec(url);
  if (file) return { fileUrl: `https://drive.google.com/file/d/${file[1]}/view`, title: "Google Drive", fileId: file[1] };
  return null;
};
