// "Enjoying Calm Calendar?": a card asking for a rating in Microsoft Store, two weeks after the first start
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import { minuteTicked } from "./view";
import { welcomeClosed, welcomeRequested } from "./welcome";
import {
  $ratingOpen,
  $ratingState,
  checkStoreFx,
  rateClicked,
  rateDeclined,
  ratingDue,
  requestRatingFx,
} from "./rating";

const day = (d: number) => new Date(2026, 10, d, 12, 0);

describe("when the rating card is due", () => {
  it("waits two weeks from the first day the app was used", () => {
    const stored = { since: "2026-11-01", answered: false };
    expect(ratingDue(stored, day(14))).toBe(false);
    expect(ratingDue(stored, day(15))).toBe(true);
    expect(ratingDue(stored, day(30))).toBe(true);
  });

  it("is never due again after an answer", () => {
    expect(ratingDue({ since: "2026-11-01", answered: true }, day(30))).toBe(false);
  });
});

const setup = async ({ store = true, since = "2026-11-01", today = 20 } = {}) => {
  const requests: number[] = [];
  const scope = fork({
    values: [[$ratingState, { since, answered: false }]],
    handlers: [
      [checkStoreFx, () => store],
      [requestRatingFx, () => void requests.push(1)],
    ],
  });
  // the first-start card was closed long ago
  await allSettled(welcomeClosed, { scope });
  await allSettled(minuteTicked, { scope, params: day(today) });
  await allSettled(checkStoreFx, { scope });
  return { scope, requests, open: () => scope.getState($ratingOpen) };
};

describe("rating card", () => {
  it("shows in the Store build once the two weeks have passed", async () => {
    expect((await setup()).open()).toBe(true);
    expect((await setup({ today: 10 })).open()).toBe(false);
  });

  it("never shows outside the Store build", async () => {
    expect((await setup({ store: false })).open()).toBe(false);
  });

  it("shows on the day it becomes due while the app keeps running", async () => {
    const { scope, open } = await setup({ today: 14 });
    expect(open()).toBe(false);
    await allSettled(minuteTicked, { scope, params: day(15) });
    expect(open()).toBe(true);
  });

  it("Rate opens the Store dialog and the card does not come back", async () => {
    const { scope, requests, open } = await setup();
    await allSettled(rateClicked, { scope });
    expect(requests).toHaveLength(1);
    expect(open()).toBe(false);
    await allSettled(minuteTicked, { scope, params: day(29) });
    expect(open()).toBe(false);
  });

  it("Not now closes the card for good without opening the Store", async () => {
    const { scope, requests, open } = await setup();
    await allSettled(rateDeclined, { scope });
    expect(requests).toHaveLength(0);
    expect(open()).toBe(false);
    await allSettled(minuteTicked, { scope, params: day(29) });
    expect(open()).toBe(false);
  });

  it("waits while the card about what the app can do is open", async () => {
    const { scope, open } = await setup();
    await allSettled(welcomeRequested, { scope });
    expect(open()).toBe(false);
  });
});
