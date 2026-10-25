# Test-only derivative. The production sandbox image and API limits do not change.
ARG SANDBOX_IMAGE=slop-native-merge-base
FROM ${SANDBOX_IMAGE} AS git-build
USER root
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl ca-certificates xz-utils zlib1g-dev && rm -rf /var/lib/apt/lists/*
# Kernel.org's published SHA256 for git-2.50.1.tar.xz. Fetch/build occurs before
# the no-network proof container; no Git transport is needed inside that container.
RUN curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://www.kernel.org/pub/software/scm/git/git-2.50.1.tar.xz -o /tmp/git.tar.xz \
    && echo '7e3e6c36decbd8f1eedd14d42db6674be03671c2204864befa2a41756c5c8fc4  /tmp/git.tar.xz' | sha256sum --check --strict \
    && mkdir /tmp/git-build && tar -xJf /tmp/git.tar.xz --strip-components=1 -C /tmp/git-build \
    && make -C /tmp/git-build -j2 prefix=/opt/slop-merge-git NO_CURL=YesPlease NO_EXPAT=YesPlease NO_OPENSSL=YesPlease NO_GETTEXT=YesPlease NO_TCLTK=YesPlease NO_PERL=YesPlease install \
    && test "$(/opt/slop-merge-git/bin/git --version)" = 'git version 2.50.1'

FROM ${SANDBOX_IMAGE}
COPY --from=git-build /opt/slop-merge-git /opt/slop-merge-git
