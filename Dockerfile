# syntax=docker/dockerfile:1
FROM node:24-alpine AS ui
# Repo-shaped layout: scripts/build-ui.mjs derives the repo root from its own
# location, so web/ must be a sibling of scripts/, not a subdirectory of ui/.
WORKDIR /src
COPY ui ./ui
COPY web ./web
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.npm node scripts/build-ui.mjs

FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/web web
ARG VERSION=docker
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /streamwebrom ./cmd/streamwebrom

FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates && adduser -D -u 10001 swr
COPY --from=build /streamwebrom /usr/local/bin/streamwebrom
USER swr
WORKDIR /data
ENV SWR_DATA=/data SWR_UDP_PORT=50000 SWR_ADDR=:8443
EXPOSE 8443/tcp 50000/udp
VOLUME ["/data"]
HEALTHCHECK CMD wget -qO- --no-check-certificate http://127.0.0.1:8443/api/health || wget -qO- --no-check-certificate https://127.0.0.1:8443/api/health || exit 1
ENTRYPOINT ["streamwebrom"]
