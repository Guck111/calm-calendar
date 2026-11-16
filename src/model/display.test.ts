// .ics subscriptions in settings
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import { newFeed } from "../shared/lib/feeds";
import { $feeds, feedAdded, feedRemoved } from "./display";

const sport = { ...newFeed("https://example.com/sport.ics", "Sport", []), id: "sport" };

describe("calendar subscriptions", () => {
  it("one removed while another downloads stays removed after the download", async () => {
    const scope = fork({ values: [[$feeds, [sport]]] });
    // the new link is downloading; meanwhile the person removes Sport
    await allSettled(feedRemoved, { scope, params: "sport" });
    await allSettled(feedAdded, { scope, params: { url: "https://example.com/films.ics", name: "Films" } });
    expect(scope.getState($feeds).map((f) => f.name)).toEqual(["Films"]);
  });

  it("the same link is not added twice", async () => {
    const scope = fork({ values: [[$feeds, [sport]]] });
    await allSettled(feedAdded, { scope, params: { url: "webcal://example.com/sport.ics", name: "Sport again" } });
    expect(scope.getState($feeds)).toEqual([sport]);
  });
});
