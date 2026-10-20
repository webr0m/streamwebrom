// Never build a queue of timer messages if the page is busy.
let pending = false;
self.onmessage = () => { pending = false; };
setInterval(() => { if (!pending) { pending = true; postMessage(0); } }, 1000 / 30);
