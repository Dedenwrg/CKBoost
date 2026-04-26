#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="${SCRIPT_DIR}"
REPO_ROOT="$(cd "${CONTRACT_DIR}/../../.." && pwd)"
CONTRACTS_DIR="${REPO_ROOT}/contracts"
CONTRACT_NAME="claimable-pool-lock"

NETWORK="testnet"
TAG=""
UPGRADE_FROM=""
INTERACTIVE_UPGRADE=false
DRY_RUN=false
BINARY_PATH="${CONTRACTS_DIR}/build/release/${CONTRACT_NAME}"
LOADED_ENV_FILE=""
TEMP_CCC_WORKDIR=""

show_usage() {
  cat <<EOF
Usage: ./deploy.sh [options]

Deploys claimable-pool-lock with ccc-deploy and records the result in this
contract's own deployments.json file.

Options:
  --network <network>       Network to deploy to [default: testnet]
  --tag <tag>               Deployment tag [default: UTC timestamp]
  --upgradeFrom <tag>       Upgrade from an existing ccc-deploy tag
  --upgrade                 Interactive upgrade mode
  --binary <path>           Contract binary [default: contracts/build/release/claimable-pool-lock]
  --dry-run                 Print the ccc-deploy command without running it
  --help, -h                Show this help

Environment:
  WALLET_PRIVATE_KEY must be present in this directory's .env or the repo root .env.
  CKB_RPC_URL may also be provided there if ccc-deploy needs a custom RPC URL.

Examples:
  ./deploy.sh --network testnet --tag v0.1.0
  ./deploy.sh --network testnet --upgradeFrom v0.1.0 --tag v0.1.1
EOF
}

cleanup_temp_ccc_workdir() {
  if [[ -z "${TEMP_CCC_WORKDIR}" || ! -d "${TEMP_CCC_WORKDIR}" ]]; then
    return
  fi

  if [[ -f "${TEMP_CCC_WORKDIR}/.claimable-pool-lock-deploy-workdir" ]]; then
    rm -rf "${TEMP_CCC_WORKDIR}"
  fi
}

trap cleanup_temp_ccc_workdir EXIT

build_contract() {
  echo -e "${BLUE}Building ${CONTRACT_NAME}...${NC}"
  mkdir -p "${CONTRACTS_DIR}/build/release"
  make -C "${CONTRACT_DIR}" build \
    TOP="${CONTRACTS_DIR}/" \
    BUILD_DIR="build/release"
}

deployment_file_fingerprint() {
  if [[ -f "${CCC_DEPLOYMENTS_JSON}" ]]; then
    shasum -a 256 "${CCC_DEPLOYMENTS_JSON}"
  else
    echo "__missing__"
  fi
}

prepare_ccc_deploy_cwd() {
  TEMP_CCC_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/claimable-pool-lock-deploy.XXXXXX")"
  touch "${TEMP_CCC_WORKDIR}/.claimable-pool-lock-deploy-workdir"

  ln -s "${CCC_DEPLOYMENTS_JSON}" "${TEMP_CCC_WORKDIR}/deployments.json"
  ln -s "${LOADED_ENV_FILE}" "${TEMP_CCC_WORKDIR}/.env"

  mkdir -p "${TEMP_CCC_WORKDIR}/contracts"
  {
    printf '.PHONY: build\n'
    printf 'build:\n'
    printf '\tmkdir -p %q\n' "${CONTRACTS_DIR}/build/release"
    printf '\t$(MAKE) -C %q build TOP=%q BUILD_DIR=build/release\n' \
      "${CONTRACT_DIR}" \
      "${CONTRACTS_DIR}/"
  } > "${TEMP_CCC_WORKDIR}/contracts/Makefile"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --upgradeFrom)
      UPGRADE_FROM="$2"
      shift 2
      ;;
    --upgrade)
      INTERACTIVE_UPGRADE=true
      shift
      ;;
    --binary)
      BINARY_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_usage
      exit 1
      ;;
  esac
done

if [[ -z "${TAG}" ]]; then
  TAG="${CONTRACT_NAME}-$(date -u +%Y%m%d%H%M%S)"
fi

if [[ "${INTERACTIVE_UPGRADE}" == "true" && -n "${UPGRADE_FROM}" ]]; then
  echo -e "${RED}Use either --upgrade or --upgradeFrom, not both.${NC}"
  exit 1
fi

CCC_DEPLOYMENTS_JSON="${SCRIPT_DIR}/deployments.json"

COMMAND=(
  ccc-deploy
  deploy
  generic_contract
  "${BINARY_PATH}"
  "--network=${NETWORK}"
  "--tag=${TAG}"
  "--typeId"
)

if [[ -n "${UPGRADE_FROM}" ]]; then
  COMMAND+=("--upgradeFrom=${UPGRADE_FROM}")
elif [[ "${INTERACTIVE_UPGRADE}" == "true" ]]; then
  COMMAND+=("--upgrade")
fi

printf -v SANITIZED_COMMAND '%q ' "${COMMAND[@]}"

echo -e "${GREEN}claimable-pool-lock deployment${NC}"
echo -e "${BLUE}Network:${NC} ${NETWORK}"
echo -e "${BLUE}Tag:${NC} ${TAG}"
echo -e "${BLUE}Binary:${NC} ${BINARY_PATH}"
echo -e "${BLUE}ccc-deploy state:${NC} ${CCC_DEPLOYMENTS_JSON}"
echo -e "${BLUE}ccc-deploy cwd:${NC} temporary workspace"
echo ""
echo "${SANITIZED_COMMAND}"
echo ""

if [[ "${DRY_RUN}" == "true" ]]; then
  echo -e "${YELLOW}Dry run only. No deployment was sent.${NC}"
  exit 0
fi

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  LOADED_ENV_FILE="${SCRIPT_DIR}/.env"
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
elif [[ -f "${REPO_ROOT}/.env" ]]; then
  LOADED_ENV_FILE="${REPO_ROOT}/.env"
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
else
  echo -e "${RED}No .env found.${NC}"
  echo "Create ${SCRIPT_DIR}/.env or ${REPO_ROOT}/.env with WALLET_PRIVATE_KEY=0x..."
  exit 1
fi

if [[ -z "${WALLET_PRIVATE_KEY:-}" ]]; then
  echo -e "${RED}WALLET_PRIVATE_KEY is missing from the loaded .env file.${NC}"
  exit 1
fi

if ! command -v ccc-deploy >/dev/null 2>&1; then
  echo -e "${RED}ccc-deploy was not found on PATH.${NC}"
  echo "Install it first, for example: npm install -g ccc-deploy"
  exit 1
fi

if [[ ! -f "${BINARY_PATH}" ]]; then
  echo -e "${YELLOW}Contract binary not found: ${BINARY_PATH}${NC}"
  build_contract
fi

if [[ ! -f "${BINARY_PATH}" ]]; then
  echo -e "${RED}Binary still not found after build: ${BINARY_PATH}${NC}"
  exit 1
fi

DEPLOYMENTS_BEFORE="$(deployment_file_fingerprint)"
prepare_ccc_deploy_cwd
echo -e "${BLUE}prepared ccc-deploy cwd:${NC} ${TEMP_CCC_WORKDIR}"

(
  cd "${TEMP_CCC_WORKDIR}"
  "${COMMAND[@]}"
)

if [[ ! -f "${CCC_DEPLOYMENTS_JSON}" ]]; then
  echo -e "${RED}ccc-deploy completed, but no deployments.json was written:${NC}"
  echo "${CCC_DEPLOYMENTS_JSON}"
  echo "The deployment may have succeeded, but it was not recorded locally."
  exit 1
fi

DEPLOYMENTS_AFTER="$(deployment_file_fingerprint)"
if [[ "${DEPLOYMENTS_AFTER}" == "${DEPLOYMENTS_BEFORE}" ]]; then
  echo -e "${RED}ccc-deploy finished, but deployments.json was not updated.${NC}"
  echo "No deployment record changed. The deployment was probably cancelled or ccc-deploy returned after an internal rebuild failure."
  exit 1
fi

echo -e "${GREEN}Deployment recorded in:${NC} ${CCC_DEPLOYMENTS_JSON}"
