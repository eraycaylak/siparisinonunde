# syntax=docker/dockerfile:1.7
# Caddy + Cloudflare DNS modülü: {slug}.DOMAIN wildcard sertifikası DNS-01 doğrulaması ister
# (Let's Encrypt wildcard'ı HTTP-01 ile vermez). 00 §10: Faz 1 alan adları Cloudflare'de.
#   docker build -f docker/caddy.Dockerfile -t siparisinonunde-caddy .

ARG CADDY_VERSION=2.10

FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Yapılandırma docker-compose.yml'de salt-okunur bağlanır: ./Caddyfile:/etc/caddy/Caddyfile:ro
