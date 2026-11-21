"""Verify both Studio shells can boot from their service worker cache."""
import argparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:18443")
parser.add_argument("--browser")
args = parser.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.browser)
    context = browser.new_context(locale="es-ES")
    page = context.new_page()
    page.goto(args.url)
    page.wait_for_function("() => navigator.serviceWorker.controller !== null", timeout=20000)
    keys = context.request.post(args.url + "/api/rooms", data={"room": "offline-studio"}).json()
    context.set_offline(True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{args.url}/studio?ui=next&room={keys['room']}#key={keys['hostKey']}")
    expect(page.locator(".studio-root [data-region='top']")).to_be_visible(timeout=15000)
    page.goto(f"{args.url}/studio?ui=legacy&room={keys['room']}#key={keys['hostKey']}")
    # The classic shell starts signalling, which must fail offline; its status
    # renderer removes the static translation attribute even on that path.
    expect(page.locator("#status[data-i18n]")).to_have_count(0, timeout=15000)
    assert not errors, errors
    browser.close()
print("Both Studio shells boot offline")
