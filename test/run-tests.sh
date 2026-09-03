#!/usr/bin/env bash
# Runs the tenant isolation tests.
#
# They need two things this repository does not carry: a MongoDB replica set (changeStream setup in
# db.js needs one, and it is what production runs), and the node_modules that live in the built
# image rather than in the repo — `mongodb` is not a package.json dependency here.
#
# So: start a throwaway Mongo, then run `node --test` inside the meshcentral image with this
# checkout mounted read-only at /src. NODE_PATH points module resolution at the image's
# node_modules, so db.js can require('mongodb') while its own code comes from /src.
#
# Usage: test/run-tests.sh [image]
set -euo pipefail

IMAGE="${1:-ghcr.io/flamingo-stack/meshcentral/meshcentral:latest}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET=mc-test-net
MONGO=mc-test-mongo
MONGO_IMAGE="${MONGO_IMAGE:-ghcr.io/flamingo-stack/registry/mongo:7.0.40}"

cleanup() {
    docker rm -f "$MONGO" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$MONGO" --network "$NET" "$MONGO_IMAGE" --replSet rs0 --bind_ip_all >/dev/null

echo "Waiting for MongoDB..."
for _ in $(seq 1 30); do
    if docker exec "$MONGO" mongosh --quiet --eval 'db.adminCommand("ping").ok' >/dev/null 2>&1; then break; fi
    sleep 2
done
docker exec "$MONGO" mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'$MONGO:27017'}]})" >/dev/null
for _ in $(seq 1 30); do
    if [ "$(docker exec "$MONGO" mongosh --quiet --eval 'db.adminCommand("hello").isWritablePrimary')" = "true" ]; then break; fi
    sleep 2
done

echo "Running tests..."
docker run --rm --network "$NET" \
    -v "$SRC:/src:ro" \
    -e NODE_PATH=/opt/meshcentral/meshcentral/node_modules \
    -e MC_SRC=/src \
    -e MC_TEST_MONGO_URL="mongodb://$MONGO:27017/meshcentral_test?replicaSet=rs0" \
    "$IMAGE" \
    node --test --test-force-exit --test-timeout=60000 /src/test/*.test.js
