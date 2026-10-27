'use strict';
const crypto = require('node:crypto');

function serverURL(value) {
  const u = new URL(value);
  if (u.username || u.password || value.length > 4096 || value.includes('\\')) throw new Error('Dirección no válida');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Usa HTTPS con un certificado válido');
  return u;
}
function trustedFrame(event, contents, origin) {
  if (!contents || contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  try { return origin && new URL(contents.getURL()).origin === origin && new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
function audioPlan(source, mode, ownPID) {
  if (mode === 'none') return { mode:'none' };
  if (source.kind === 'browser') return { mode:'tab', frame:source.frame };
  if (source.own || !Number.isInteger(ownPID) || ownPID <= 0) throw new Error('No se puede capturar el audio de la sala');
  if (source.kind === 'window' && mode === 'application') {
    if (!Number.isInteger(source.pid) || source.pid <= 0 || source.pid === ownPID) throw new Error('No se pudo aislar el audio de esta aplicación');
    return { mode:'native', pid:source.pid, include:true };
  }
  if (mode === 'system') return { mode:'native', pid:ownPID, include:false };
  throw new Error('Elige audio de aplicación, sistema o sin audio');
}

// One selected capture per window. Teardown of an old share cannot stop its replacement.
class CaptureLease {
  constructor(stop = () => {}) { this.stopNative=stop; this.current=null; }
  create(data) { this.clear(); return this.current={...data,id:crypto.randomUUID(),started:false}; }
  get(id) { return this.current?.id===id ? this.current : null; }
  clear(id) {
    if (id && !this.get(id)) return false;
    const old=this.current;this.current=null;
    if (old?.started) this.stopNative();
    return true;
  }
}
module.exports={serverURL,trustedFrame,audioPlan,CaptureLease};
