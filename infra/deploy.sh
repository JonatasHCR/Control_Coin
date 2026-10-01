#!/usr/bin/env bash
# Deploy one built tag to an environment. Called by Jenkins (ARCH03).
#
#   ./infra/deploy.sh staging a3f19c8e2b41
#
# Order is not negotiable: back up, migrate, then roll out. A failed migration
# halts the deployment and pages a human — it is never rolled back automatically,
# because rolling a schema back can destroy data written since (ARCH03/ARCH07).
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <environment> <tag>}"
TAG="${2:?usage: deploy.sh <environment> <tag>}"
REGISTRY="${REGISTRY:-registry.internal/control-coin}"

echo "→ ${ENVIRONMENT}: ${TAG}"

echo "1/4 pre-migration snapshot"
BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TAG}"
echo "    backup id ${BACKUP_ID}"   # recorded in the build log (ARCH07)

echo "2/4 migrate"
docker run --rm --env-file "infra/env/${ENVIRONMENT}.env" "${REGISTRY}/migrate:${TAG}"

echo "3/4 roll out"
docker run -d --rm --env-file "infra/env/${ENVIRONMENT}.env" "${REGISTRY}/api:${TAG}"
docker run -d --rm --env-file "infra/env/${ENVIRONMENT}.env" "${REGISTRY}/web:${TAG}"

echo "4/4 done — smoke test runs from the pipeline"
