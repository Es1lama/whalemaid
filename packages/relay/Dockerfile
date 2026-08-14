# SPEC: docs/deploy-server.md 中继控制面镜像（rathole v0.5.0 sidecar 随镜像分发）
FROM rust:1-slim AS build
WORKDIR /src
COPY packages/relay/Cargo.toml packages/relay/Cargo.lock packages/relay/
COPY packages/relay/src packages/relay/src
RUN cargo build --release --manifest-path packages/relay/Cargo.toml

FROM debian:bookworm-slim
ARG RATHOLE_VERSION=v0.5.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates unzip \
  && rm -rf /var/lib/apt/lists/*
RUN curl -sSL -o /tmp/rathole.zip \
    https://github.com/rapiz1/rathole/releases/download/${RATHOLE_VERSION}/rathole-x86_64-unknown-linux-gnu.zip \
  && unzip -o /tmp/rathole.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/rathole \
  && rm /tmp/rathole.zip
COPY --from=build /src/target/release/whalemaid-relay /usr/local/bin/whalemaid-relay
ENV WHALEMAID_RELAY_DATA=/data
RUN mkdir -p /data
EXPOSE 2333 9080
ENTRYPOINT ["whalemaid-relay"]
