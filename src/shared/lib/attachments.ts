// Event attachments in Google Calendar are Google Drive files. With the calendar.events scope you can attach
// a file by its link; uploading a file from the computer needs the Drive scope (stage 3b).
import type { Attachment } from "../api/types";

/** Google doesn't accept more */
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

/** Google Drive file link → attachment. The title is a placeholder for now ("Google Docs"): the real file name
 *  is known only to Drive. Not a Drive file link — null */
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
