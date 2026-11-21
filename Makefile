VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

.PHONY: run ui ui-skip test test-race lint build all windows launcher docker clean overflow

run:
	go run ./cmd/streamwebrom -open

# The UI pipeline needs node; owners build from WSL, where node is not installed,
# so every target that would chain `ui` — `test`, `build`, `all` and the release
# path through `launcher` — chains it only when node is actually reachable. With-
# out node the binary still builds, but from whatever web/ is on disk: `ui-skip`
# says so loudly, because a silent pass reads like "the bundle is current". CI
# (ubuntu + node) always rebuilds it. `ui-skip` has to be a real recipe rather than
# an empty prerequisite: with nothing to do, make would report `build`/`all` up to
# date and skip the Go compile too.
UIPREREQ = $(shell command -v node >/dev/null 2>&1 && echo ui)

ui:
	node scripts/build-ui.mjs

ui-skip:
	@echo "node not found: skipping the UI bundle — the binary embeds whatever web/ already holds"

.PHONY: ui ui-skip

test: $(UIPREREQ)
	@$(if $(UIPREREQ),true,$(MAKE) ui-skip)
	go vet ./...
	go test -count=1 ./...
	for f in web/js/*.js; do cp $$f /tmp/$$(basename $$f).mjs && node --check /tmp/$$(basename $$f).mjs || exit 1; done
	python3 scripts/jslint.py web/js
	node --test tests/*.test.mjs

test-race:
	CGO_ENABLED=1 go test -race -count=1 ./...

build: $(UIPREREQ)
	@$(if $(UIPREREQ),true,$(MAKE) ui-skip)
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom ./cmd/streamwebrom

all: $(UIPREREQ)
	@$(if $(UIPREREQ),true,$(MAKE) ui-skip)
	@mkdir -p dist
	@for p in $(PLATFORMS); do \
	  os=$${p%/*}; arch=$${p#*/}; ext=; [ $$os = windows ] && ext=.exe; \
	  echo "→ $$os/$$arch"; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom-$$os-$$arch$$ext ./cmd/streamwebrom || exit 1; \
	done

windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom-windows-amd64.exe ./cmd/streamwebrom

# Native Windows app (.NET 8, WinForms tray launcher) with the Go server embedded.
launcher: windows
	dotnet publish windows/StreamWebRom.Launcher -c Release -o dist/windows-launcher

docker:
	docker build -t streamwebrom:$(VERSION) .

clean:
	rm -rf dist

# Blocking layout gate: needs a Chromium and a running server, so it is not part of `test`.
# 18497, not CI's 18443: locally that port is where a foreign instance from hours ago tends to
# live, and the binary serves the web/ frozen at its own compile time. The gate now refuses an
# uptime over 120s, so pointing it at a disposable port is what makes the refusal rare.
overflow:
	python3 scripts/overflow-smoke.py --url http://localhost:18497
