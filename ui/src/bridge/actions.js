// ui/src/bridge/actions.js
export const ERROR_DOMAINS = ["media", "broadcast", "room", "network"];

const DOMAIN_BY_PREFIX = [
  [/^(source|device)\./, "media"],
  [/^(live|record|relay|dest)\./, "broadcast"],
  [/^network\./, "network"],
];

export function domainOf(action) {
  for (const [pattern, domain] of DOMAIN_BY_PREFIX) if (pattern.test(action)) return domain;
  return "room";
}

// Every command is a thin delegate: the engine owns the effect, the UI owns no
// state of its own. Plan 2 swaps createFixtureEngine for the real WebRTC one.
export function createActions(engine) {
  const run = (name) => async (payload) => { await engine.apply(name, payload ?? {}); };
  return Object.fromEntries(
    [
      "scene.select", "scene.addSource", "scene.removeSource", "scene.setLayout", "scene.setFeatured",
      "scene.rename", "scene.copyObsLink", "program.setClearScreen", "program.countdown",
      "live.start", "live.stop", "record.toggle", "relay.retry", "relay.setProvider",
      "dest.add", "dest.update", "dest.remove", "dest.toggle",
      "source.mute", "source.hide", "source.remove", "source.setQuality", "device.camera", "device.screen", "device.media",
      "room.save", "room.forget", "brand.apply", "banner.set", "chat.send", "people.admit", "people.deny", "people.mute",
      "network.retry",
    ].map((name) => [name, run(name)]),
  );
}
