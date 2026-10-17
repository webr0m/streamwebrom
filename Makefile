VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

.PHONY: run test test-race lint build all windows launcher docker clean

run:
	go run ./cmd/streamwebrom -open

test:
	go vet ./...
	go test -count=1 ./...
	for f in web/js/*.js; do cp $$f /tmp/$$(basename $$f).mjs && node --check /tmp/$$(basename $$f).mjs || exit 1; done
	python3 scripts/jslint.py web/js

test-race:
	CGO_ENABLED=1 go test -race -count=1 ./...

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/streamwebrom ./cmd/streamwebrom

all:
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
