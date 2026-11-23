// The app version: the same number as on the installer and in Microsoft Store
import { version } from "../../../package.json";

export const APP_VERSION: string = version;

/** What changed in this version: its section of the "What's new" page on the website (scripts/build-site.mjs) */
export const WHATS_NEW_URL = `https://calmcalendar.co.uk/whats-new.html#v${APP_VERSION}`;
