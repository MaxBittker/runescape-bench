#!/bin/bash
# Run 30-minute skill XP benchmarks — all models launched concurrently
# with 2-minute staggered start times.
#
# Each model's output goes to its own log file under /tmp/harbor-staggered-30m-*.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/run-common.sh"

STAGGER_SECS=90

ALL_MODELS="
claude-code|anthropic/claude-opus-4-6|opus
claude-code|anthropic/claude-opus-4-5|opus45
claude-code|anthropic/claude-sonnet-4-6|sonnet46
claude-code|anthropic/claude-sonnet-4-5|sonnet45
claude-code|anthropic/claude-haiku-4-5|haiku
codex|openai/gpt-5.2-codex|codex
codex|openai/gpt-5.3-codex|codex53
codex|openai/gpt-5.4|gpt54
gemini-cli|google/gemini-3-pro-preview|gemini
gemini-cli|google/gemini-3.1-pro-preview|gemini31
claude-code|glm-5|glm
kimi-opencode|openrouter/moonshotai/kimi-k2.5|kimi
qwen3-opencode|openrouter/qwen/qwen3-coder-next|qwen3
qwen35-opencode|openrouter/qwen/qwen3.5-35b-a3b|qwen35
"

ALL_SKILLS="attack defence strength hitpoints ranged prayer magic woodcutting fishing mining cooking fletching crafting smithing firemaking thieving"

load_env "$REPO_ROOT/.env"
GLM_KEY="${GLM_API_KEY:-}"

regenerate_tasks "$REPO_ROOT/generate-tasks.ts"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="/tmp/harbor-staggered-30m-${TIMESTAMP}"
mkdir -p "$LOG_DIR"

echo "Staggered 30m skill run — ${TIMESTAMP}"
echo "Logs: $LOG_DIR"
echo ""

MODEL_LIST="opus opus45 sonnet46 sonnet45 haiku codex codex53 gpt54 gemini gemini31 glm kimi qwen3 qwen35"
PIDS=()
MODEL_NAMES=()
DELAY=0

for model_name in $MODEL_LIST; do
  entry=$(lookup_model "$model_name" "$ALL_MODELS")
  if [ -z "$entry" ]; then
    echo "Unknown model: $model_name — skipping"
    continue
  fi

  IFS='|' read -r agent model label <<< "$entry"

  # Per-model config
  ENV_PREFIX=""
  AGENT_FLAG="-a '$agent'"
  HARBOR_ENV="modal"
  MODEL_EXTRA_ARGS=""

  if ! configure_model_env "$model_name" "$REPO_ROOT/agents" "$entry"; then
    continue
  fi

  case "$model_name" in
    codex|codex53|gpt54)
      MODEL_EXTRA_ARGS="--ak run_timeout_sec=1900"
      ;;
    kimi|qwen3|qwen35)
      MODEL_EXTRA_ARGS="--ak run_timeout_sec=1800"
      ;;
  esac

  if [ "$model_name" = "codex53" ]; then
    CODEX_AUTH_FILE="$HOME/.codex/auth.json"
    if [ ! -f "$CODEX_AUTH_FILE" ]; then
      echo "  WARNING: ~/.codex/auth.json not found, skipping codex53"
      continue
    fi
    CODEX_AUTH_B64=$(base64 < "$CODEX_AUTH_FILE")
    ENV_PREFIX="$ENV_PREFIX CODEX_AUTH_JSON_B64='$CODEX_AUTH_B64'"
  fi

  TASK_FLAGS=""
  for skill in $ALL_SKILLS; do
    TASK_FLAGS="$TASK_FLAGS -t '${skill}-xp-30m'"
  done

  JOB_NAME="skills-30m-${label}-${TIMESTAMP}"
  LOG_FILE="${LOG_DIR}/${label}.log"

  echo "  [+${DELAY}s] $model_name → $LOG_FILE"

  # Launch in a subshell with a sleep delay
  (
    sleep "$DELAY"
    echo "[$(date '+%H:%M:%S')] Starting $model_name ($model)" >> "$LOG_FILE"
    eval "$ENV_PREFIX harbor run \
      -p '$REPO_ROOT/tasks' \
      $TASK_FLAGS \
      $AGENT_FLAG \
      -m '$model' \
      --job-name '$JOB_NAME' \
      --env $HARBOR_ENV \
      --ek sandbox_timeout_secs=7200 \
      -n 16 \
      -k 1 \
      $MODEL_EXTRA_ARGS" >> "$LOG_FILE" 2>&1
    echo "[$(date '+%H:%M:%S')] Finished $model_name (exit=$?)" >> "$LOG_FILE"
  ) &

  PIDS+=($!)
  MODEL_NAMES+=("$model_name")
  DELAY=$((DELAY + STAGGER_SECS))
done

echo ""
echo "All ${#PIDS[@]} models launched (staggered by ${STAGGER_SECS}s)."
echo "PIDs: ${PIDS[*]}"
echo ""
echo "Monitor with:"
echo "  tail -f ${LOG_DIR}/*.log"
echo ""

# Wait for all and report
FAILED=0
for i in "${!PIDS[@]}"; do
  if ! wait "${PIDS[$i]}"; then
    echo "FAILED: ${MODEL_NAMES[$i]} (PID ${PIDS[$i]})"
    FAILED=$((FAILED + 1))
  else
    echo "  DONE: ${MODEL_NAMES[$i]}"
  fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All models complete."
else
  echo "$FAILED of ${#PIDS[@]} model(s) had errors. Check logs in $LOG_DIR"
fi
echo ""
echo "Next steps:"
echo "  bun extractors/extract-skill-results.ts --horizon 30m"
echo "  open views/graph-skills.html?horizon=30m"
