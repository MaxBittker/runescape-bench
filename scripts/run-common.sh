#!/bin/bash
# Shared shell functions for run scripts.
# Source this file: source "$(dirname "$0")/run-common.sh"

# ── load_env: source .env file and export all variables ──────────
load_env() {
  local env_file="$1"
  if [ -f "$env_file" ]; then
    set -a  # auto-export all variables
    source "$env_file"
    set +a
  fi
}

# ── lookup_model: find model entry by label (bash 3 compatible) ──
# Usage: entry=$(lookup_model "$name" "$ALL_MODELS")
lookup_model() {
  local name="$1"
  local models="$2"
  echo "$models" | while IFS='|' read -r agent model label; do
    if [ "$label" = "$name" ]; then
      echo "$agent|$model|$label"
      return 0
    fi
  done
}

# ── configure_model_env: set ENV_PREFIX/AGENT_FLAG for a model ───
# Sets these variables in the caller's scope:
#   ENV_PREFIX  — env vars to prepend to the harbor command
#   AGENT_FLAG  — agent flag for harbor (e.g. -a 'claude-code')
# Returns 1 if model should be skipped (missing credentials).
configure_model_env() {
  local model_name="$1"
  local agents_dir="$2"

  ENV_PREFIX=""
  AGENT_FLAG="-a '$(echo "$3" | cut -d'|' -f1)'"

  case "$model_name" in
    glm)
      if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        echo "  WARNING: OPENROUTER_API_KEY not found in .env, skipping glm"
        return 1
      fi
      ENV_PREFIX="PYTHONPATH=$agents_dir:\${PYTHONPATH:-}"
      AGENT_FLAG="--agent-import-path 'glm_adapter:GlmOpenCode'"
      ;;
    codex|codex53|gpt54|gpt54mini|gpt54nano)
      ENV_PREFIX="PYTHONPATH=$agents_dir:\${PYTHONPATH:-}"
      AGENT_FLAG="--agent-import-path 'codex_adapter:CodexWithTimeout'"
      ;;
    kimi)
      if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        echo "  WARNING: OPENROUTER_API_KEY not found in .env, skipping kimi"
        return 1
      fi
      ENV_PREFIX="PYTHONPATH=$agents_dir:\${PYTHONPATH:-}"
      AGENT_FLAG="--agent-import-path 'kimi_adapter:KimiOpenCode'"
      ;;
    qwen3)
      if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        echo "  WARNING: OPENROUTER_API_KEY not found in .env, skipping qwen3"
        return 1
      fi
      ENV_PREFIX="PYTHONPATH=$agents_dir:\${PYTHONPATH:-}"
      AGENT_FLAG="--agent-import-path 'qwen3_adapter:Qwen3OpenCode'"
      ;;
    qwen35)
      if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        echo "  WARNING: OPENROUTER_API_KEY not found in .env, skipping qwen35"
        return 1
      fi
      ENV_PREFIX="PYTHONPATH=$agents_dir:\${PYTHONPATH:-}"
      AGENT_FLAG="--agent-import-path 'qwen35_adapter:Qwen35OpenCode'"
      ;;
  esac
  return 0
}

# ── regenerate_tasks: run the task generator ─────────────────────
regenerate_tasks() {
  local script="$1"
  echo "Regenerating benchmark tasks..."
  bun "$script"
  echo ""
}
