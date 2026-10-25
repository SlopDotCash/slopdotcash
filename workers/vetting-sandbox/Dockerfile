FROM docker.io/cloudflare/sandbox:0.12.14@sha256:b8175e89ae5efd83987ffd5056f57c28c390fd5706d42ef70fb669e275248e7b AS git-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl ca-certificates xz-utils zlib1g-dev && rm -rf /var/lib/apt/lists/*
# Official kernel.org archive. The fixed operation does not need Git networking.
RUN curl --disable --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://www.kernel.org/pub/software/scm/git/git-2.56.0.tar.xz -o /tmp/git.tar.xz \
    && echo '26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3  /tmp/git.tar.xz' | sha256sum --check --strict \
    && mkdir /tmp/git-build && tar -xJf /tmp/git.tar.xz --strip-components=1 -C /tmp/git-build \
    && make -C /tmp/git-build -j2 prefix=/opt/slop-merge-git NO_CURL=YesPlease NO_EXPAT=YesPlease NO_OPENSSL=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease NO_PERL=YesPlease install \
    && test "$(/opt/slop-merge-git/bin/git --version)" = 'git version 2.56.0'

FROM docker.io/cloudflare/sandbox:0.12.14@sha256:b8175e89ae5efd83987ffd5056f57c28c390fd5706d42ef70fb669e275248e7b
RUN apt-get update && apt-get install -y --no-install-recommends python3 libseccomp2 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /analysis/work /opt/slop && chown 65534:65534 /analysis/work && chmod 0700 /analysis/work
COPY --from=git-build /opt/slop-merge-git /opt/slop-merge-git
COPY .build/merge.mjs /opt/slop/merge.mjs
COPY supervise.py /opt/slop/supervise.py
RUN chmod 0555 /opt/slop/supervise.py /opt/slop/merge.mjs
