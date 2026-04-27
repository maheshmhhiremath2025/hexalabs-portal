#!/bin/bash
# Build and push all 11 lab images to Docker Hub (kumar202699)
# Run from: /path/to/synergific-portal/dockerfiles/
# Usage: chmod +x build-and-push-all.sh && ./build-and-push-all.sh

set -e

DOCKER_USER="kumar202699"
PLATFORM="linux/amd64"

LABS=(
  "lab-ai-ml"
  "lab-ansible"
  "lab-bigdata-workspace"
  "lab-claude-code"
  "lab-devops-cicd"
  "lab-docker-k8s"
  "lab-elk-stack"
  "lab-fullstack"
  "lab-monitoring"
  "lab-soc-analyst"
  "lab-terraform"
)

echo "=== Logging in to Docker Hub ==="
docker login -u "$DOCKER_USER"

TOTAL=${#LABS[@]}
COUNT=0
FAILED=()

for LAB in "${LABS[@]}"; do
  COUNT=$((COUNT + 1))
  TAG="${DOCKER_USER}/${LAB}:1.0"
  echo ""
  echo "=== [$COUNT/$TOTAL] Building $TAG ==="

  if docker build --platform "$PLATFORM" -t "$TAG" "./${LAB}/"; then
    echo "=== [$COUNT/$TOTAL] Pushing $TAG ==="
    if docker push "$TAG"; then
      echo "=== [$COUNT/$TOTAL] $LAB done ==="
    else
      echo "*** PUSH FAILED: $LAB ***"
      FAILED+=("$LAB")
    fi
  else
    echo "*** BUILD FAILED: $LAB ***"
    FAILED+=("$LAB")
  fi
done

echo ""
echo "=============================="
echo "  Completed: $((TOTAL - ${#FAILED[@]}))/$TOTAL"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "  Failed: ${FAILED[*]}"
else
  echo "  All images pushed successfully!"
fi
echo "=============================="
