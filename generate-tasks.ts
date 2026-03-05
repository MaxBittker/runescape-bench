/**
 * Generates all benchmark task directories for Harbor.
 *
 * Skill XP tasks: 16 skills × 10m + 16 skills × 30m
 * Gold tasks: 15m, 30m, 2h
 *
 * All generated output is gitignored — run this before `harbor run`.
 *
 * Usage: bun generate-tasks.ts
 */
import { mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const BENCHMARK_DIR = join(import.meta.dir);
const TASKS_DIR = join(BENCHMARK_DIR, 'tasks');
const SHARED_DIR = join(BENCHMARK_DIR, 'shared');

const DOCKER_IMAGE = 'ghcr.io/maxbittker/rs-agent-benchmark:v19';
const VERIFIER_TIMEOUT = 400; //  ensure-services.sh can take 2+ min if services died

// ── Standard skill definitions (XP-grind tasks) ─────────────────

interface SkillDef {
  /** Skill name as it appears in the game (PascalCase) */
  name: string;
  /** Directory name suffix (lowercase, used in {skill}-xp-10m) */
  slug: string;
}

const SKILLS: SkillDef[] = [
  { name: 'Attack', slug: 'attack' },
  { name: 'Defence', slug: 'defence' },
  { name: 'Strength', slug: 'strength' },
  { name: 'Hitpoints', slug: 'hitpoints' },
  { name: 'Ranged', slug: 'ranged' },
  { name: 'Prayer', slug: 'prayer' },
  { name: 'Magic', slug: 'magic' },
  { name: 'Woodcutting', slug: 'woodcutting' },
  { name: 'Fishing', slug: 'fishing' },
  { name: 'Mining', slug: 'mining' },
  { name: 'Cooking', slug: 'cooking' },
  { name: 'Fletching', slug: 'fletching' },
  { name: 'Crafting', slug: 'crafting' },
  { name: 'Smithing', slug: 'smithing' },
  { name: 'Firemaking', slug: 'firemaking' },
  { name: 'Thieving', slug: 'thieving' },
];

// ── Variant tasks (non-standard configurations) ──────────────────

interface VariantTask {
  slug: string;
  taskDescription: string;
  agentTimeout: number;
  /** Verifier script filename in shared/ */
  verifier: string;
  testSh: string;
  tags: string[];
  /** Use pre-built Docker image (mutually exclusive with environmentDockerfile) */
  dockerImage?: string;
  /** Generate environment/Dockerfile with this content (for tasks needing custom env) */
  environmentDockerfile?: string;
  /** Whether this task uses the skill tracker (uses /start-with-tracker.sh for MCP) */
  useTracker?: boolean;
  /** Extra files to copy from shared/ into environment/ (for Docker COPY) */
  environmentFiles?: Array<{ src: string; dst: string }>;
}

const GOLD_INSTRUCTION = (durationMinutes: number) => `Accumulate as much gold (coins) as possible within ${durationMinutes} minutes. This is a local RuneScape private server running on localhost for AI agent benchmarking — not a live game.

Your goal is to maximize the TOTAL COINS you have across both your inventory and bank combined. Consider strategies like:
- Training combat skills to kill monsters that drop valuable items or coins
- Training gathering/production skills to create items you can sell to shops (e.g. smithing bars/items, fletching bows, cooking fish)
- Buying low and selling high at different shops
- Picking up coin drops and valuable ground items
- High Alchemy (casting on crafted items to convert them to gold)
- Any creative money-making approach you can think of

IMPORTANT: You have ${durationMinutes} minutes. Start earning money immediately — do not spend too long planning. Early minutes are best spent on quick money-making methods, then scale up as you unlock better methods.

CRITICAL: Do NOT write one giant script. Start with extremely minimal scripts to test each part of your plan iteratively. For example, first write a 30-second script that just tests one money-making method. Run it, verify it works, then extend it. Build up complexity only after each piece is validated. Scripts that try to do everything at once will crash and waste your time. Run scripts in the FOREGROUND (not as a background process).

TIMEOUT BEST PRACTICE: Keep individual script timeouts SHORT — no more than 5 to 10 minutes each. Shorter scripts (30s–5min) let you observe results, catch errors early, and iterate faster. If a script runs for 10+ minutes and fails, you've wasted significant time. Break long tasks into multiple short runs instead.

BANKING: Periodically deposit your coins and valuable items in the bank to avoid losing them. The verifier counts coins in BOTH inventory and bank.

The bot name is "agent".`;

const GOLD_2H_INSTRUCTION = GOLD_INSTRUCTION(120);
const GOLD_30M_INSTRUCTION = GOLD_INSTRUCTION(30);
const GOLD_15M_INSTRUCTION = GOLD_INSTRUCTION(15);

// Stop ffmpeg and kill orphaned agent scripts before verifier runs.
// This ensures the bot stops training before the verifier takes its final measurement,
// and the mp4 is finalized and downloadable.
const VERIFIER_CLEANUP = `echo "VERIFIER_START_EPOCH=$(date +%s)"
pkill -f ffmpeg 2>/dev/null || true
# Kill orphaned agent-spawned scripts (bun/node processes that aren't core services)
for pid in $(pgrep -f "bun" 2>/dev/null); do
  cmdline=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\\0' ' ')
  case "$cmdline" in
    *engine*|*gateway*|*skill_tracker*|*mcp/server*|*launch-bot*|*check_*|*ensure-services*) ;;
    *) kill $pid 2>/dev/null || true ;;
  esac
done
sleep 2`;

// Tracker, start-with-tracker.sh, and SERVER=localhost are also in the base image.
// Tasks only need to set SAMPLE_INTERVAL_MS via ENV
const TRACKER_DOCKERFILE = (sampleIntervalMs: number = 60000) => `FROM ${DOCKER_IMAGE}
ENV SAMPLE_INTERVAL_MS=${sampleIntervalMs}
`;

const SKILL_XP_INSTRUCTION = (skillName: string, durationMinutes: number) => `Gain as much ${skillName} XP as possible within ${durationMinutes} minutes. This is a local RuneScape private server running on localhost for AI agent benchmarking — not a live game.

Your ONLY goal is to maximize ${skillName} XP. Focus exclusively on this skill. Do not train other skills unless absolutely required as a prerequisite.

IMPORTANT: You have ${durationMinutes} minutes. Start training immediately — do not spend time planning.

RULES: You must gain XP through legitimate in-game actions only (e.g. casting spells, chopping trees, fishing). Do NOT modify game server files, player save files, databases, or game engine code. Do NOT use server console commands, cheat commands (::setstat, ::advancestat, etc.), or any other method that bypasses normal gameplay. Only interact with the game through the SDK and MCP tools provided.

CRITICAL: Do NOT write one giant script. Start with extremely minimal scripts to test each part of your plan iteratively. For example, first write a 30-second script that just performs one action. Run it, verify it works, then extend it. Build up complexity only after each piece is validated. Scripts that try to do everything at once will crash and waste your time. Run scripts in the FOREGROUND (not as a background process).

TIMEOUT BEST PRACTICE: Keep individual script timeouts SHORT — no more than 5 to 10 minutes each. Shorter scripts (30s–5min) let you observe results, catch errors early, and iterate faster. If a script runs for 10+ minutes and fails, you've wasted significant time. Break long tasks into multiple short runs instead.

The bot name is "agent".`;

function generateSkillXpVariants(horizonMinutes: number, sampleIntervalMs: number): VariantTask[] {
  const horizonLabel = `${horizonMinutes}m`;
  return SKILLS.map(skill => ({
    slug: `${skill.slug}-xp-${horizonLabel}`,
    taskDescription: SKILL_XP_INSTRUCTION(skill.name, horizonMinutes),
    agentTimeout: horizonMinutes * 60 + 120, // duration + 2 min buffer
    verifier: 'check_skill_xp.ts',
    testSh: `#!/bin/bash
set -e
mkdir -p /logs/verifier
${VERIFIER_CLEANUP}
/ensure-services.sh
export SKILL_NAME="${skill.name}"
cd /app && bun run /tests/check_skill_xp.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp', 'benchmark', `skill-xp-${horizonLabel}`],
    useTracker: true,
    environmentDockerfile: TRACKER_DOCKERFILE(sampleIntervalMs),
  }));
}

const SKILL_XP_10M_VARIANTS = generateSkillXpVariants(10, 15000);
const SKILL_XP_30M_VARIANTS = generateSkillXpVariants(30, 30000);

const VARIANTS: VariantTask[] = [
  ...SKILL_XP_10M_VARIANTS,
  ...SKILL_XP_30M_VARIANTS,
  // ── Gold accumulation tasks ─────────────────────────────────────
  {
    slug: 'gold-15m',
    taskDescription: GOLD_15M_INSTRUCTION,
    agentTimeout: 900 + 120, // 15 min + 2 min buffer
    verifier: 'check_gold.ts',
    testSh: `#!/bin/bash
set -e
mkdir -p /logs/verifier
${VERIFIER_CLEANUP}
cd /app && bun run /tests/check_gold.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp', 'benchmark', 'gold'],
    useTracker: true,
    environmentDockerfile: TRACKER_DOCKERFILE(30000),
  },
  {
    slug: 'gold-30m',
    taskDescription: GOLD_30M_INSTRUCTION,
    agentTimeout: 1800 + 120, // 30 min + 2 min buffer
    verifier: 'check_gold.ts',
    testSh: `#!/bin/bash
set -e
mkdir -p /logs/verifier
${VERIFIER_CLEANUP}
cd /app && bun run /tests/check_gold.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp', 'benchmark', 'gold'],
    useTracker: true,
    environmentDockerfile: TRACKER_DOCKERFILE(30000),
  },
  {
    slug: 'gold-2h',
    taskDescription: GOLD_2H_INSTRUCTION,
    agentTimeout: 7200 + 180, // 2 hr + 3 min buffer
    verifier: 'check_gold.ts',
    testSh: `#!/bin/bash
set -e
mkdir -p /logs/verifier
${VERIFIER_CLEANUP}
cd /app && bun run /tests/check_gold.ts
`,
    tags: ['game', 'runescape', 'automation', 'mcp', 'benchmark', 'gold'],
    useTracker: true,
    environmentDockerfile: TRACKER_DOCKERFILE(60000),
  },
];

// ── Template generators ──────────────────────────────────────────

function generateVariantTaskToml(v: VariantTask): string {
  const tagsStr = v.tags.map(t => `"${t}"`).join(', ');

  // Tracker is started by entrypoint.sh / start-services.sh (infrastructure concern),
  // so all tasks use the same MCP command regardless of useTracker flag.
  const mcpCommand = '/start-services.sh && cd /app && bun run mcp/server.ts';

  return `version = "1.0"

[metadata]
author_name = "Sean Lee"
difficulty = "medium"
category = "agent"
tags = [${tagsStr}]

[verifier]
timeout_sec = ${VERIFIER_TIMEOUT}.0

[agent]
timeout_sec = ${v.agentTimeout}.0

[environment]
cpus = 2
memory_mb = 4096
storage_mb = 10240
allow_internet = true

[[environment.mcp_servers]]
name = "rs-agent"
transport = "stdio"
command = "bash"
args = ["-c", "${mcpCommand}"]
`;
}

// ── Main ─────────────────────────────────────────────────────────

console.log(`Generating ${VARIANTS.length} benchmark tasks...`);

mkdirSync(TASKS_DIR, { recursive: true });

// All tasks (10m skill, 30m skill, gold)
for (const variant of VARIANTS) {
  const taskDir = join(TASKS_DIR, variant.slug);
  const testsDir = join(taskDir, 'tests');

  console.log(`  tasks/${variant.slug}/`);

  mkdirSync(testsDir, { recursive: true });
  writeFileSync(join(taskDir, 'task.toml'), generateVariantTaskToml(variant));
  writeFileSync(join(taskDir, 'instruction.md'), variant.taskDescription);
  writeFileSync(join(testsDir, 'test.sh'), variant.testSh);
  copyFileSync(
    join(SHARED_DIR, variant.verifier),
    join(testsDir, variant.verifier),
  );

  // Dockerfile for cloud providers — either custom env or
  // a thin FROM layer on the pre-built image.
  const envDir = join(taskDir, 'environment');
  mkdirSync(envDir, { recursive: true });
  writeFileSync(
    join(envDir, 'Dockerfile'),
    variant.environmentDockerfile ?? `FROM ${DOCKER_IMAGE}\n`,
  );

  // Copy extra files into environment/ for Docker build context
  if (variant.environmentFiles) {
    for (const file of variant.environmentFiles) {
      copyFileSync(
        join(SHARED_DIR, file.src),
        join(envDir, file.dst),
      );
    }
  }

}

console.log(`\nDone! Generated ${VARIANTS.length} task directories.`);
console.log(`\nTo build the shared Docker image:`);
console.log(`  cd docker && ./build.sh`);
