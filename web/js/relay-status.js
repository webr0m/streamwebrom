// User-facing relay/quota copy. Number grouping follows the interface language.
import { t, lang, onLangChange } from "./i18n.js";

const LOCALES = { es: "es-CL", en: "en-US", ru: "ru-RU" };

export const gigabytes = n => `${(Math.max(0, Number(n) || 0) / 1e9).toLocaleString(LOCALES[lang()] || "es-CL", { maximumFractionDigits: 1 })} GB`;

export function relayMessage(status, now = Date.now()) {
  if (!status) return { label: t("misc.relayLocalActive"), text: t("misc.relayLocalActiveText"), warning: false };
  if (status.switchAt) return { label: t("misc.relaySwitching"), text: t("misc.relaySwitchingText", { seconds: Math.max(0, Math.ceil((status.switchAt - now) / 1000)) }), warning: true };
  if (status.provider === "local") return { label: t("misc.relayLocalActive"), text: status.reason === "quota" ? t("misc.relayLocalQuotaText") : t("misc.relayLocalFallbackText"), warning: status.reason !== "configured" };
  if (status.warning) return { label: t("misc.relayWarningLabel"), text: t("misc.relayWarningText", { estimated: gigabytes(status.estimatedBytes), budget: gigabytes(status.budgetBytes) }), warning: true };
  return { label: t("misc.relayCloudflareActive"), text: t("misc.relayCloudflareText", { usage: gigabytes(status.usageBytes) }), warning: false };
}

export function relayMonitor(sig, { banner, label, text, details }, notify) {
  let status = null, warned = "";
  const paint = () => {
    const m = relayMessage(status);
    label.textContent = m.label; text.textContent = m.text;
    banner.classList.toggle("quota-warning", m.warning);
    if (status) {
      details.textContent = t("misc.relayDetails", {
        usage: gigabytes(status.usageBytes), estimated: gigabytes(status.estimatedBytes),
        budget: gigabytes(status.budgetBytes), warning: gigabytes(status.warningBytes), free: gigabytes(status.freeBytes),
      }) + (status.recoveryReserve ? t("misc.relayDetailsReserve", { reserve: gigabytes(status.recoveryReserve) }) : "") + t("misc.relayDetailsNote");
    } else details.textContent = m.text;
  };
  const receive = e => {
    status = e.detail.relay || null; paint();
    const key = status ? `${status.month}:${status.provider}:${status.reason}:${status.warning}` : "";
    if (relayMessage(status).warning && key !== warned) { warned = key; notify(relayMessage(status).text); }
  };
  sig.addEventListener("welcome", receive); sig.addEventListener("relay-status", receive);
  const timer = setInterval(() => { if (status?.switchAt) paint(); }, 500);
  const stopLang = onLangChange(() => paint());
  paint();
  return { destroy() { clearInterval(timer); stopLang(); sig.removeEventListener("welcome", receive); sig.removeEventListener("relay-status", receive); } };
}
