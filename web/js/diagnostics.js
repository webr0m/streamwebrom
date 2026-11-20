import { $, el, api, iceConfiguration, networkMode, params } from "./rtc.js";
import { checkVideoRoute } from "./network.js";
import { installI18n, t, onLangChange } from "./i18n.js";

installI18n();

const RESULT_NODES = { media: "#mediaResult", relay: "#relayResult", video: "#videoRouteResult" };
const results = { media: null, relay: null, video: null };

// A stored status is either a live translation spec ({key, vars}) or raw text
// from the browser ({raw}). Specs are re-rendered on every language change.
function resolveText(spec) {
  if (!spec) return "";
  if (spec.raw !== undefined) return spec.raw;
  const vars = {};
  for (const [name, value] of Object.entries(spec.vars || {})) {
    vars[name] = value && typeof value === "object" ? resolveText(value) : value;
  }
  return t(spec.key, vars);
}
function paint(slot) {
  $(RESULT_NODES[slot]).textContent = resolveText(results[slot]);
}
function show(slot, key, vars) {
  results[slot] = { key, vars };
  paint(slot);
}
function errorSpec(error) {
  if (error?.i18nKey) return { key: error.i18nKey, vars: error.i18nVars };
  return { raw: error?.message || String(error) };
}
function showError(slot, wrapKey, error) {
  results[slot] = wrapKey ? { key: wrapKey, vars: { error: errorSpec(error) } } : errorSpec(error);
  paint(slot);
}
function fail(key, vars) {
  return Object.assign(new Error(t(key, vars)), { i18nKey: key, i18nVars: vars });
}

$("#networkMode").value = networkMode(params.get("network"));
$("#networkMode").onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set("network", $("#networkMode").value);
  history.replaceState(null, "", url);
};

function row(label, ok, detail) {
  return el("p", {}, el("strong", { text: `${ok ? "✓" : "⚠"} ${label}: ` }), detail);
}
async function check() {
  const box = $("#checks");
  box.replaceChildren(
    row(t("diagnostics.checkSecureContext"), window.isSecureContext, t(window.isSecureContext ? "diagnostics.secureOk" : "diagnostics.secureMissing")),
    row(t("diagnostics.checkWebrtc"), typeof RTCPeerConnection !== "undefined", t(typeof RTCPeerConnection !== "undefined" ? "diagnostics.webrtcOk" : "diagnostics.webrtcMissing")),
    row(t("diagnostics.checkDevices"), !!navigator.mediaDevices?.getUserMedia, t(navigator.mediaDevices?.getUserMedia ? "diagnostics.devicesOk" : "diagnostics.devicesMissing")),
  );
  try {
    const cfg = await api("/api/config");
    box.append(row(t("diagnostics.checkServer"), true, t("diagnostics.serverOk", { version: cfg.version || t("diagnostics.versionDev") })));
    box.append(row(t("diagnostics.checkMultistream"), cfg.capabilities?.multistream, t(cfg.capabilities?.multistream ? "diagnostics.multistreamOk" : "diagnostics.multistreamMissing")));
    const turn = (cfg.ice || []).some((server) => [server.urls].flat().some((url) => /^turns?:/.test(url)));
    box.append(row(t("diagnostics.checkTurn"), turn, t(turn ? "diagnostics.turnOk" : "diagnostics.turnMissing")));
    if (cfg.relay?.provider) {
      let detail;
      if (cfg.relay.provider === "cloudflare") detail = t("diagnostics.relayCloudflare");
      else {
        const reason = cfg.relay.reason;
        const reasonKey = reason === "quota" ? "diagnostics.reasonQuota"
          : reason === "configured" ? "diagnostics.reasonConfigured"
          : reason === "state-unavailable" ? "diagnostics.reasonStateUnavailable"
          : "diagnostics.reasonUnavailable";
        detail = t("diagnostics.relayLocal", { reason: t(reasonKey) });
      }
      box.append(row(t("diagnostics.checkTurnProvider"), turn, detail));
    }
  } catch (e) { box.append(row(t("diagnostics.checkServer"), false, e.message)); }
}
$("#refresh").onclick = check;
$("#media").onclick = async () => {
  const button = $("#media"); button.disabled = true;
  let stream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw fail("diagnostics.mediaNeedHttps");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    show("media", "diagnostics.mediaOk");
  } catch (e) { showError("media", "diagnostics.mediaFailed", e); }
  finally { stream?.getTracks().forEach((track) => track.stop()); button.disabled = false; }
};

$("#relay").onclick = async () => {
  const button = $("#relay");
  button.disabled = true; show("relay", "diagnostics.relayChecking");
  let pc;
  try {
    const cfg = await api("/api/config");
    const mode = $("#networkMode").value;
    const configured = mode === "local" ? cfg.localIce || [] : cfg.ice || [];
    const servers = configured.map(s => ({ ...s, urls: [s.urls].flat().filter(url => /^turns?:/i.test(url)) })).filter(s => s.urls.length);
    if (!servers.length) throw fail("diagnostics.relayNotConfigured");
    pc = new RTCPeerConnection({ ...iceConfiguration(servers, mode), iceTransportPolicy: "relay" });
    pc.createDataChannel("relay-check");
    await new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(fail("diagnostics.relayTimeout")), 15000);
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) { clearTimeout(timer); reject(fail("diagnostics.relayNoRoute")); }
        else if (candidate.type === "relay") { clearTimeout(timer); resolve(); }
      };
      try { await pc.setLocalDescription(await pc.createOffer()); }
      catch (e) { clearTimeout(timer); reject(e); }
    });
    show("relay", "diagnostics.relayOk");
  } catch (e) { showError("relay", null, e); }
  finally { if (pc) { pc.onicecandidate = null; pc.close(); } button.disabled = false; }
};

$("#videoRoute").onclick = async () => {
  const button = $("#videoRoute"), selector = $("#networkMode");
  button.disabled = selector.disabled = true;
  show("video", "diagnostics.videoChecking");
  try {
    const mode = selector.value;
    // Validate the selected route before creating a disposable test room.
    const cfg = await api("/api/config");
    iceConfiguration(mode === "local" ? cfg.localIce || [] : cfg.ice || [], mode);
    await checkVideoRoute(mode);
    show("video", "diagnostics.videoOk", { route: selector.selectedOptions[0].textContent });
  } catch (e) { showError("video", "diagnostics.videoFailed", e); }
  finally {
    button.disabled = selector.disabled = false;
  }
};

// Static labels are rewritten by installI18n(); the live checks and the status
// lines have to be rebuilt here, in the new language.
onLangChange(() => {
  check();
  for (const slot of Object.keys(results)) paint(slot);
});

check();
