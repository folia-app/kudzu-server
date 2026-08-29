#!/usr/bin/env bash
# Run the golden test across a matrix of node + canvas versions.
#
#   ./test/matrix.sh                 default matrix
#   ./test/matrix.sh 24-bookworm:3.2.0
#
# The first entry is treated as the reference: golden.json is recorded there,
# then every later entry is compared against it.
set -u
cd "$(dirname "$0")/.."
MATRIX=("${@:-}")
if [ -z "${MATRIX[0]:-}" ]; then
  MATRIX=(18-bullseye:2.11.2 20-bookworm:3.2.0 22-bookworm:3.2.0 24-bookworm:3.2.0)
fi

build () { # tag node canvas
  cat > /tmp/Dockerfile.$1 <<DOCKER
FROM --platform=linux/amd64 node:$2
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev \
    libgif-dev librsvg2-dev python-is-python3 git ca-certificates >/dev/null 2>&1
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev >/dev/null 2>&1 && npm i canvas@$3 >/dev/null 2>&1
COPY . .
DOCKER
  docker build -q -f /tmp/Dockerfile.$1 -t "$1" . >/dev/null 2>&1
}

first=1
for entry in "${MATRIX[@]}"; do
  nv="${entry%%:*}"; cv="${entry##*:}"
  tag="kzgolden-${nv%%-*}-${cv//./}"
  printf '%-34s ' "node $nv · canvas $cv"
  if ! build "$tag" "$nv" "$cv"; then echo "BUILD FAILED"; continue; fi
  if [ $first -eq 1 ]; then
    docker run --rm --platform=linux/amd64 -v "$PWD/test:/app/test" "$tag" \
      node test/golden.js --record 2>/dev/null | head -1
    first=0
  else
    docker run --rm --platform=linux/amd64 -v "$PWD/test:/app/test" "$tag" \
      node test/golden.js 2>/dev/null | tail -2 | tr '\n' ' '
    echo
  fi
done
