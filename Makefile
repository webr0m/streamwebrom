VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

.PHONY: run ui test test-race lint build all windows launcher docker clean overflow

run:
	go run ./cmd/streamwebrom -open

# Release targets require a fresh bundle. For Go-only development, `make run`
# still works on a clean checkout and serves the classic Studio.
ui:
	node scripts/build-ui.mjs

test: ui
	go vet ./...
	go test -count=1 ./...
	for f in web/js/*.js; do node --input-type=module --check < "$$f" || exit 1; done
	node --check web/sw.js
	python3 scripts/jslint.py web/js
	node --test tests/*.test.mjs
	cd ui && npm test
	cd desktop && npm test

test-race:
	CGO_ENABLED=1 go test -race -count=1 ./...

build: ui
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom ./cmd/streamwebrom

all: ui
	@mkdir -p dist
	@for p in $(PLATFORMS); do \
	  os=$${p%/*}; arch=$${p#*/}; ext=; [ $$os = windows ] && ext=.exe; \
	  echo "→ $$os/$$arch"; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom-$$os-$$arch$$ext ./cmd/streamwebrom || exit 1; \
	done

windows: ui
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
