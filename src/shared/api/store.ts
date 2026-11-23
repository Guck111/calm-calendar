// Microsoft Store: the rating dialog. Only the Store build (MSIX) has it; the installers from GitHub do not.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./bus";
import { readJson } from "../lib/storage";

/** in the browser (npm run dev, interface tests) the Store build is played by this localStorage switch */
const MOCK_KEY = "calm.mockStore";

export const isStoreBuild = async (): Promise<boolean> =>
  inTauri ? invoke<boolean>("store_rating_available") : readJson<unknown>(MOCK_KEY, false) === true;

/** The Store's own "Rate and review" dialog over the main window */
export const requestStoreRating = async (): Promise<void> => {
  if (inTauri) await invoke("request_store_rating");
};
