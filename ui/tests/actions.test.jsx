// ui/tests/actions.test.jsx
import { test, expect } from "vitest";
import { createActions, domainOf, ERROR_DOMAINS } from "../src/bridge/actions.js";
import { createFixtureEngine } from "../src/bridge/fixture-engine.js";
import { nextStudioFixture } from "../src/fixtures/next-studio.js";

test("every documented action exists and lands in one of four domains", () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const actions = createActions(engine);
  const names = [
    "scene.select", "scene.addSource", "scene.removeSource", "scene.setLayout", "scene.setFeatured",
    "scene.rename", "scene.copyObsLink", "program.setClearScreen", "program.countdown",
    "live.start", "live.stop", "record.toggle", "relay.retry", "relay.setProvider",
    "dest.add", "dest.update", "dest.remove", "dest.toggle",
    "source.mute", "source.hide", "source.remove", "source.setQuality", "device.camera", "device.screen", "device.media",
    "room.save", "room.forget", "brand.apply", "banner.set", "chat.send", "people.admit", "people.deny", "people.mute",
    "network.retry",
  ];
  for (const name of names) expect(typeof actions[name], name).toBe("function");
  expect(ERROR_DOMAINS).toEqual(["media", "broadcast", "room", "network"]);
  expect(domainOf("source.mute")).toBe("media");
  expect(domainOf("live.start")).toBe("broadcast");
  expect(domainOf("scene.select")).toBe("room");
  expect(domainOf("network.retry")).toBe("network");
});

test("scene commands delegate to the engine, not to the DOM", async () => {
  const engine = createFixtureEngine(nextStudioFixture);
  const actions = createActions(engine);
  await actions["scene.setLayout"]({ layout: "pip" }, engine);
  expect(engine.calls.at(-1)).toEqual(["scene.setLayout", { layout: "pip" }]);
  await actions["dest.toggle"]({ id: "yt", active: false }, engine);
  expect(engine.calls.at(-1)[0]).toBe("dest.toggle");
});
