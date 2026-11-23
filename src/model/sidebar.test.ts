// The side panel: hidden by its button in a wide window, a pull-out panel over the calendar in a narrow one
import { allSettled, fork } from "effector";
import { describe, expect, it } from "vitest";
import { quickFocusRequested } from "./quick";
import { $sidebar, narrowChanged, sidebarClosed, sidebarToggled } from "./sidebar";

const setup = async (narrow: boolean) => {
  const scope = fork();
  await allSettled(narrowChanged, { scope, params: narrow });
  return { scope, state: () => scope.getState($sidebar) };
};

describe("side panel in a wide window", () => {
  it("is shown beside the calendar until its button hides it", async () => {
    const { scope, state } = await setup(false);
    expect(state()).toEqual({ shown: true, over: false });
    await allSettled(sidebarToggled, { scope });
    expect(state()).toEqual({ shown: false, over: false });
    await allSettled(sidebarToggled, { scope });
    expect(state()).toEqual({ shown: true, over: false });
  });

  it("stays when something asks to close a pulled-out panel", async () => {
    const { scope, state } = await setup(false);
    await allSettled(sidebarClosed, { scope });
    expect(state().shown).toBe(true);
  });

  it("comes back when quick add is asked for", async () => {
    const { scope, state } = await setup(false);
    await allSettled(sidebarToggled, { scope });
    await allSettled(quickFocusRequested, { scope });
    expect(state()).toEqual({ shown: true, over: false });
  });
});

describe("side panel in a narrow window", () => {
  it("is hidden, and its button pulls it out over the calendar", async () => {
    const { scope, state } = await setup(true);
    expect(state()).toEqual({ shown: false, over: true });
    await allSettled(sidebarToggled, { scope });
    expect(state()).toEqual({ shown: true, over: true });
    await allSettled(sidebarClosed, { scope });
    expect(state()).toEqual({ shown: false, over: true });
  });

  it("pulls out for quick add", async () => {
    const { scope, state } = await setup(true);
    await allSettled(quickFocusRequested, { scope });
    expect(state()).toEqual({ shown: true, over: true });
  });

  it("does not change the choice made for a wide window", async () => {
    const { scope, state } = await setup(false);
    await allSettled(sidebarToggled, { scope });
    await allSettled(narrowChanged, { scope, params: true });
    await allSettled(sidebarToggled, { scope });
    await allSettled(narrowChanged, { scope, params: false });
    expect(state()).toEqual({ shown: false, over: false });
  });

  it("folds back when the window gets narrow again", async () => {
    const { scope, state } = await setup(true);
    await allSettled(sidebarToggled, { scope });
    await allSettled(narrowChanged, { scope, params: false });
    await allSettled(narrowChanged, { scope, params: true });
    expect(state()).toEqual({ shown: false, over: true });
  });
});
