#!/usr/bin/env bash
# =============================================================================
# push.sh — build, tag, and push the lab-bigdata-workspace image to a registry.
#
# Usage:
#   ./push.sh                   # builds + pushes :1.0 and :latest to default registry
#   ./push.sh 1.1               # builds + pushes :1.1 and :latest
#   REGISTRY=myreg.azurecr.io ./push.sh 1.1
#
# The default REGISTRY is empty, which pushes to Docker Hub under the
# 'getlabs' org. To push to ACR/ECR/GHCR, set REGISTRY explicitly.
#
# Before running, make sure you're authenticated:
#   Docker Hub:  docker login
#   ACR:         az acr login --name <registry-name>
#   ECR:         aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
#   GHCR:        echo $GH_PAT | docker login ghcr.io -u <username> --password-stdin
# =============================================================================

set -euo pipefail

VERSION="${1:-1.0}"
REGISTRY="${REGISTRY:-}"   # empty = Docker Hub
NAMESPACE="${NAMESPACE:-getlabs}"
IMAGE_NAME="${IMAGE_NAME:-lab-bigdata-workspace}"

# Compose the full image reference
if [ -n "$REGISTRY" ]; then
  FULL="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"
else
  FULL="${NAMESPACE}/${IMAGE_NAME}"
fi

echo "============================================================"
echo "Building lab-bigdata-workspace v${VERSION}"
echo "Target: ${FULL}:${VERSION}  +  ${FULL}:latest"
echo "============================================================"
echo

# Always build for linux/amd64 — production hosts are x86_64. If you build
# on Apple Silicon without --platform, Docker produces an arm64 image that
# won't run on Linux x86 hosts. This flag forces the right architecture.
docker build \
  --platform linux/amd64 \
  -t "${FULL}:${VERSION}" \
  -t "${FULL}:latest" \
  .

echo
echo "============================================================"
echo "Build OK. Verifying image with smoke tests..."
echo "============================================================"
docker run --rm --platform linux/amd64 --entrypoint bash "${FULL}:${VERSION}" -c '
  set -e
  java -version 2>&1 | head -1
  python3 --version
  kafka-topics.sh --version 2>&1 | tail -1
  spark-submit --version 2>&1 | grep -m1 "version"
  mysql --version
  /opt/cassandra/bin/cassandra -v
  /usr/local/bin/ttyd --version
'

echo
echo "============================================================"
echo "Smoke tests passed. Ready to push."
echo "============================================================"
echo
echo "About to push:"
echo "  ${FULL}:${VERSION}"
echo "  ${FULL}:latest"
echo
read -r -p "Press ENTER to continue, or Ctrl-C to abort: "

docker push "${FULL}:${VERSION}"
docker push "${FULL}:latest"

echo
echo "============================================================"
echo "Done. Production hosts can now pull:"
echo "  docker pull ${FULL}:${VERSION}"
echo "============================================================"
echo
echo "Catalog entry in services/containerService.js currently uses:"
echo "  image: 'getlabs/lab-bigdata-workspace:1.0'"
echo
echo "If you pushed to a non-default registry, update that line to:"
echo "  image: '${FULL}:${VERSION}'"
