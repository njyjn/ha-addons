# ConfigSync. Built on the device by the Supervisor (no prebuilt image).
FROM alpine:3.24

ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
ARG TARGETARCH

# tzdata so the Supervisor-provided TZ sets the schedule and commit times.
RUN apk add --no-cache bash git openssh-client python3 jq tzdata ca-certificates

# gitleaks, pinned and checksum-verified. arm64 only: the hash is for that build.
RUN set -eu; \
    arch="${TARGETARCH:-}"; \
    if [ -z "$arch" ] && [ "$(uname -m)" = "aarch64" ]; then arch=arm64; fi; \
    [ "$arch" = "arm64" ] || { echo "ConfigSync only builds for arm64 (got '${arch:-$(uname -m)}')" >&2; exit 1; }; \
    file="gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz"; \
    apk add --no-cache --virtual .fetch curl; \
    curl -fsSL -o "/tmp/$file" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/$file"; \
    apk del .fetch; \
    echo "${GITLEAKS_SHA256}  /tmp/$file" | sha256sum -c -; \
    tar -xzf "/tmp/$file" -C /usr/local/bin gitleaks; \
    rm "/tmp/$file"; \
    gitleaks version

# GitHub's published Ed25519 host key, checked against its published fingerprint.
COPY known_hosts /etc/configsync/known_hosts
RUN ssh-keygen -lf /etc/configsync/known_hosts \
    | grep -q 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

COPY configsync.py /app/configsync.py
CMD ["python3", "-u", "/app/configsync.py"]
