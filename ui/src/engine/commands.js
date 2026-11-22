export const SCENES = Array.from({ length: 8 }, (_, i) => String(i + 1));

export function sceneOf(state, name) {
  const scene = name === "1" ? state : state.outputs?.[name];
  return { stage: scene?.stage || [], layout: scene?.layout || "grid", featured: scene?.featured || "" };
}

export function scenePatch(state, name, patch) {
  return name === "1" ? patch : { outputs: { ...state.outputs, [name]: { ...sceneOf(state, name), ...patch } } };
}

export const stateMessage = (value) => ({ type: "state", value });
export const requestSource = (target, action) => ({ type: "request", target, action });
export const screenPermission = (target, action) => ({ type: "screen-permission", target, action });

export function studioUrl(room, key, mode, search = "") {
  const query = new URLSearchParams(search);
  query.delete("key");
  query.delete("demo");
  query.set("room", room);
  query.set("ui", mode);
  return `/studio?${query}#${new URLSearchParams({ key })}`;
}
