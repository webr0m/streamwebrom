import { useEffect, useRef } from "react";
import { t } from "../i18n.js";
import { StudioDialog } from "./primitives/StudioDialog.jsx";

function Devices({ engine, command }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    const container = document.createElement("div");
    container.className = "col";
    node.replaceChildren(container);
    void engine.renderDevices(container, (prefs, change) =>
      command("device.settings", { patch: { ...prefs }, change }))
      .catch(error => { container.textContent = error.message; });
    return () => container.remove();
  }, [engine, command]);
  return <div ref={ref} />;
}

export function BetaDialog({ dialog, snapshot, engine, command, onClose }) {
  const title = {
    devices: "devices.settingsTitle", destinations: "studio.destinations", room: "studio.room",
    switch: "studio.betaOpenClassic", screen: "studio.screen", stop: "studio.betaStopLive",
  }[dialog];
  const { broadcast, people } = snapshot;
  return (
    <StudioDialog title={t(title)} onClose={onClose}>
      {dialog === "devices" ? <Devices engine={engine} command={command} /> : null}
      {dialog === "switch" ? <div className="col">
        <p>{t("studio.betaSwitchWarning")}</p>
        <a className="btn" href={engine.legacyUrl()}>{t("studio.betaOpenClassic")}</a>
      </div> : null}
      {dialog === "stop" ? <div className="col">
        <p>{t("studiojs.endLiveConfirm")}</p>
        <button type="button" onClick={() => { void command("live.stop", {}); onClose(); }}>{t("studio.betaStopLive")}</button>
      </div> : null}
      {dialog === "screen" ? <form className="col" onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void command("device.screen", { surface: data.get("surface"), audio: data.has("audio") });
        onClose();
      }}>
        <label>{t("studio.betaScreenSource")}<select name="surface">
          <option value="browser">{t("studio.betaBrowserTab")}</option>
          <option value="window">{t("studio.betaWindow")}</option>
          <option value="monitor">{t("studio.betaEntireScreen")}</option>
        </select></label>
        <label className="row"><input type="checkbox" name="audio" defaultChecked />{t("studio.betaScreenAudio")}</label>
        <button type="submit">{t("studio.screen")}</button>
      </form> : null}
      {dialog === "destinations" ? <div className="col">
        <p>{t("studio.destHelp")}</p>
        <form className="col" onSubmit={async e => {
          e.preventDefault();
          const form = e.currentTarget, data = new FormData(form);
          await command("dest.add", Object.fromEntries(data));
          form.elements.key.value = "";
        }}>
          <label>{t("studio.platform")}<input name="name" maxLength={40} /></label>
          <label>{t("studio.serverURL")}<input name="url" required autoComplete="off" /></label>
          <label>{t("studio.streamKey")}<input name="key" type="password" autoComplete="off" /></label>
          <button type="submit">{t("studio.addDestination")}</button>
        </form>
        {broadcast.destinations.map(dest => <div key={dest.id} className="row">
          <label className="row grow"><input type="checkbox" checked={dest.active} onChange={() => command("dest.toggle", { id: dest.id })} /><span>{dest.name} · {dest.url}</span></label>
          <button type="button" aria-label={t("studio.betaRemoveDestination")} onClick={() => command("dest.remove", { id: dest.id })}>×</button>
        </div>)}
      </div> : null}
      {dialog === "room" ? <div className="col">
        <button type="button" onClick={() => command("room.invite", {})}>{t("studio.invite")}</button>
        <h3>{t("studio.people")}</h3>
        {people.knocks.map(peer => <div key={peer.id} className="row wrap">
          <span>{peer.name}</span>
          <button type="button" onClick={() => command("people.admit", { id: peer.id })}>{t("studiojs.admitToBackstage")}</button>
          <button type="button" onClick={() => command("people.deny", { id: peer.id })}>{t("studiojs.deny")}</button>
        </div>)}
        {people.peers.filter(peer => peer.id !== snapshot.room.myId && peer.role === "guest").map(peer => <div key={peer.id} className="row wrap">
          <span>{peer.name}</span>
          {peer.screenRequested ? <>
            <button type="button" onClick={() => command("people.screen", { id: peer.id, action: "allow" })}>{t("studiojs.allowScreen")}</button>
            <button type="button" onClick={() => command("people.screen", { id: peer.id, action: "deny" })}>{t("studiojs.denyScreen")}</button>
          </> : null}
        </div>)}
        <h3>{t("studio.connectionUsage")}</h3>
        <p>{t(broadcast.relay.mode === "cloudflare" ? "studiojs.relayCloudSelected" : "studiojs.relayLocalSelected")}</p>
        {broadcast.relay.mode === "cloudflare" ? <button type="button" onClick={() => command("relay.setProvider", { provider: "local" })}>{t("studio.useLocalRelay")}</button> : null}
        {broadcast.relay.mode !== "cloudflare" && broadcast.relay.access.password && broadcast.relay.access.available ? <form className="col" onSubmit={e => {
          e.preventDefault();
          const input = e.currentTarget.elements.master, password = input.value;
          input.value = "";
          void command("relay.setProvider", { provider: "cloudflare", password });
        }}>
          <label>{t("studio.masterPassword")}<input name="master" type="password" required autoComplete="off" /></label>
          <button type="submit">{t("studio.enableCloudflare")}</button>
        </form> : null}
        <p>{t("studio.relaySwitchNote")}</p>
      </div> : null}
    </StudioDialog>
  );
}
