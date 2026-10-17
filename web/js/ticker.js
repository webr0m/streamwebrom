// Frame clock for video effects: Worker timers are not throttled when the tab
// is hidden, unlike setInterval/requestAnimationFrame on the page.
setInterval(() => postMessage(0), 1000 / 30);
