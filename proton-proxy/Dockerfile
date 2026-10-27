# Official Gluetun image, pinned. Bump GLUETUN_VERSION (and the app version) to upgrade.
ARG GLUETUN_VERSION=v3.41.3
# Same image as docker.io/qmcgaw/gluetun, from GitHub's registry (no Docker Hub pull limits).
FROM ghcr.io/qdm12/gluetun:${GLUETUN_VERSION}

RUN apk add --no-cache bash jq

COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENTRYPOINT ["/run.sh"]
