#!/usr/bin/env bun
/**
 * Extract skill XP tracking data from Harbor job results for the graph viewer.
 *
 * Detects skill from job dir name: {skill}-xp-{horizon}-{model}-...
 * Groups by model -> skill.
 *
 * Usage:
 *   bun extractors/extract-skill-results.ts                              # 30m (default)
 *   bun extractors/extract-skill-results.ts --horizon 10m                # 10m
 *   bun extractors/extract-skill-results.ts --horizon 30m --filter opus  # Filter by pattern
 *   bun extractors/extract-skill-results.ts jobs/woodcutting-xp-10m-*    # Specific job dirs
 *
 * Output:
 *   results/skills-{horizon}/_combined.json  — { model: { skill: { finalXp, finalLevel, samples[], tokenUsage } } }
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import {
  type Sample, type TrackingData, type TokenUsage,
  detectModel, detectModelFromConfig, getTrialDirs,
  findTrackingInTrial, findRewardInTrial, findTokenUsageInTrial,
  trimSamplesToHorizon,
  parseCLIArgs, resolveJobDirs, writeResults,
} from '../shared/extract-utils';

const JOBS_DIR = join(import.meta.dir, '..', 'jobs');

const KNOWN_MODELS = ['opus', 'opus45', 'sonnet46', 'sonnet45', 'haiku', 'codex53', 'codex', 'gpt54', 'gemini31', 'gemini', 'glm', 'kimi', 'qwen35', 'qwen3'];

const KNOWN_SKILLS = [
  'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
  'woodcutting', 'fishing', 'mining', 'cooking', 'fletching', 'crafting',
  'smithing', 'firemaking', 'thieving',
];

/** Detect skill from directory name: {skill}-xp-{horizon}-{model}-... */
function detectSkill(dirName: string, horizon: string): string | null {
  const lower = dirName.toLowerCase();
  for (const skill of KNOWN_SKILLS) {
    if (lower.startsWith(`${skill}-xp-${horizon}`)) return skill;
  }
  return null;
}

/** Detect skill from trial dir name: {skill}-xp-{horizon}__{random} */
function detectSkillFromTrialName(trialDirName: string, horizon: string): string | null {
  const taskPart = trialDirName.split('__')[0];
  if (!taskPart) return null;
  return detectSkill(taskPart, horizon);
}

function detectSkillFromConfig(jobDir: string, horizon: string): string | null {
  const configPath = join(jobDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const taskPath = config?.tasks?.[0]?.path || '';
    const lower = taskPath.toLowerCase();
    for (const skill of KNOWN_SKILLS) {
      if (lower.includes(`${skill}-xp-${horizon}`)) return skill;
    }
  } catch {}
  return null;
}

// ── Trajectory extraction ────────────────────────────────────────

interface TrajectoryStep {
  source: 'agent' | 'tool' | 'user';
  text: string;
}

function extractTrajectoryFromTrial(trialDir: string): { steps: TrajectoryStep[] } | null {
  const agentDir = join(trialDir, 'agent');
  if (!existsSync(agentDir)) return null;

  const trajectoryPath = join(agentDir, 'trajectory.json');
  if (existsSync(trajectoryPath)) {
    try {
      const traj = JSON.parse(readFileSync(trajectoryPath, 'utf-8'));
      return parseClaudeTrajectory(traj);
    } catch {}
  }

  const codexPath = join(agentDir, 'codex.txt');
  if (existsSync(codexPath)) {
    try {
      return parseCodexLog(readFileSync(codexPath, 'utf-8'));
    } catch {}
  }

  // Handle any opencode-*.txt variant (kimi, qwen3, qwen35, etc.)
  try {
    const agentFiles = readdirSync(agentDir);
    const opencodePath = agentFiles.find(f => f.startsWith('opencode-') && f.endsWith('.txt'));
    if (opencodePath) {
      try {
        return parseKimiLog(readFileSync(join(agentDir, opencodePath), 'utf-8'));
      } catch {}
    }
  } catch {}

  const geminiPath = join(agentDir, 'gemini-cli.txt');
  if (existsSync(geminiPath)) {
    try {
      return parseGeminiCliLog(readFileSync(geminiPath, 'utf-8'));
    } catch {}
  }

  return null;
}

function parseClaudeTrajectory(traj: any): { steps: TrajectoryStep[] } {
  const rawSteps = traj.steps || [];
  const steps: TrajectoryStep[] = [];

  for (const step of rawSteps) {
    const src = step.source;
    const msg: string = step.message || '';
    if (!msg) continue;

    if (src === 'agent') {
      if (msg.startsWith('Executed ')) {
        const toolName = msg.replace('Executed ', '').split(' ')[0];
        steps.push({ source: 'tool', text: toolName });
      } else {
        steps.push({ source: 'agent', text: msg });
      }
    }
  }

  return { steps: steps.slice(0, 200) };
}

function parseCodexLog(content: string): { steps: TrajectoryStep[] } {
  const steps: TrajectoryStep[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'item.completed' && entry.item) {
        const item = entry.item;
        if (item.type === 'agent_message' && item.text) {
          steps.push({ source: 'agent', text: item.text });
        } else if (item.type === 'reasoning' && item.text) {
          steps.push({ source: 'agent', text: item.text });
        } else if (item.type === 'command_execution' && item.command) {
          steps.push({ source: 'tool', text: item.command });
        } else if (item.type === 'file_change') {
          steps.push({ source: 'tool', text: `file_change: ${item.filename || 'unknown'}` });
        }
      }
    } catch {}
  }

  return { steps: steps.slice(0, 200) };
}

function parseKimiLog(content: string): { steps: TrajectoryStep[] } {
  const steps: TrajectoryStep[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('[kimi-loop]')) {
      steps.push({ source: 'agent', text: line });
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'text') {
        const text = entry.part?.content || entry.part?.text || '';
        if (text) {
          steps.push({ source: 'agent', text });
        }
      } else if (entry.type === 'tool_use') {
        const tool = entry.part?.tool || '';
        const input = entry.part?.state?.input || {};
        if (tool === 'bash') {
          steps.push({ source: 'tool', text: `bash: ${input.command || ''}`.slice(0, 200) });
        } else if (tool === 'read') {
          steps.push({ source: 'tool', text: `read: ${input.filePath || ''}` });
        } else if (tool === 'write') {
          steps.push({ source: 'tool', text: `write: ${input.filePath || ''}` });
        } else if (tool) {
          steps.push({ source: 'tool', text: tool });
        }
      }
    } catch {}
  }

  return { steps: steps.slice(0, 200) };
}

function parseGeminiCliLog(content: string): { steps: TrajectoryStep[] } {
  const steps: TrajectoryStep[] = [];
  const lines = content.split('\n');

  let inBashBlock = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Detect start of a bash command block (heredoc file content + syntax errors)
    if (trimmed.startsWith('Bash command parsing error detected')) {
      inBashBlock = true;
      // Extract the filename from the command as a tool step
      const fileMatch = trimmed.match(/> ([\w/./-]+\.\w+)$/);
      const label = fileMatch ? `write: ${fileMatch[1]}` : 'bash';
      steps.push({ source: 'tool', text: label });
      continue;
    }

    // End of bash block: the closing bracket of "EOF Syntax Errors: [...]"
    if (inBashBlock) {
      if (trimmed === ']') inBashBlock = false;
      continue;
    }

    // Skip noise lines
    if (trimmed.startsWith('YOLO mode is enabled')) continue;
    if (trimmed.startsWith('[agent-loop]')) continue;
    if (trimmed.startsWith('missing pgrep output')) continue;

    // Everything else is agent text
    steps.push({ source: 'agent', text: trimmed });
  }

  return { steps: steps.slice(0, 200) };
}

// ── Main ─────────────────────────────────────────────────────────

const { filter, horizon: horizonArg, explicitDirs } = parseCLIArgs(process.argv.slice(2));
const HORIZON = horizonArg || '30m';
const RESULTS_DIR = join(import.meta.dir, '..', 'results', `skills-${HORIZON}`);

console.log(`Extracting skill-xp-${HORIZON} results...\n`);

const jobDirs = resolveJobDirs(JOBS_DIR, explicitDirs, filter, (name, f) => {
  const lower = name.toLowerCase();
  // Match single-task dirs ({skill}-xp-{horizon}-...) or dataset dirs (skills-{horizon}-...)
  const isSkillMatch = KNOWN_SKILLS.some(s => lower.startsWith(`${s}-xp-${HORIZON}`));
  const isDatasetMatch = lower.startsWith(`skills-${HORIZON}-`);
  if (!isSkillMatch && !isDatasetMatch) return false;
  return !f || lower.includes(f);
});

// Extract and group by model -> skill
const combined: Record<string, Record<string, {
  jobName: string;
  finalXp: number;
  finalLevel: number;
  durationSeconds: number;
  sampleCount: number;
  samples: Sample[];
  tokenUsage?: TokenUsage;
  trimmedSamples?: number;
}>> = {};

let extracted = 0;

// Parse horizon into milliseconds for sample trimming
const horizonMatch = HORIZON.match(/^(\d+)m$/);
const horizonMs = horizonMatch ? parseInt(horizonMatch[1]) * 60 * 1000 : 0;

for (const dir of jobDirs) {
  const jobName = basename(dir);
  let model = detectModel(jobName, KNOWN_MODELS);
  if (model === 'unknown') model = detectModelFromConfig(dir, KNOWN_MODELS, {
    preMatch: (lower) => {
      if (lower.includes('gemini-3.1') || lower.includes('gemini-3_1')) return 'gemini31';
      return null;
    },
  });

  if (model === 'unknown') {
    console.log(`  skip: ${jobName} (can't detect model)`);
    continue;
  }

  // Detect skill at job level (old single-task format: {skill}-xp-{horizon}-{model}-...)
  const jobSkill = detectSkill(jobName, HORIZON) || detectSkillFromConfig(dir, HORIZON);

  // Iterate over trial dirs to handle both single-task and multi-task (dataset) jobs
  const trialDirs = getTrialDirs(dir);
  if (trialDirs.length === 0) {
    console.log(`  skip: ${jobName} (no trial dirs)`);
    continue;
  }

  for (const trialDir of trialDirs) {
    const trialName = basename(trialDir);
    // Detect skill: try trial dir name first (works for dataset jobs), then fall back to job name
    const skill = detectSkillFromTrialName(trialName, HORIZON) || jobSkill;

    if (!skill) {
      console.log(`  skip: ${jobName}/${trialName} (can't detect skill)`);
      continue;
    }

    const tracking = findTrackingInTrial(trialDir);
    const reward = findRewardInTrial(trialDir);
    const tokenUsage = findTokenUsageInTrial(trialDir);
    const trajectory = extractTrajectoryFromTrial(trialDir);

    if (!tracking && !reward) {
      continue;
    }

    const allSamples = tracking?.samples || [];

    // Trim samples to the intended game-time window
    const samples = horizonMs > 0 ? trimSamplesToHorizon(allSamples, horizonMs) : allSamples;
    const trimmedCount = allSamples.length - samples.length;

    const durationSeconds = samples.length > 0
      ? samples[samples.length - 1].elapsedMs / 1000
      : 0;

    // Derive XP from the last in-window sample's skill data (more accurate than
    // the verifier's post-timeout reading when orphaned scripts inflate XP)
    let finalXp = reward?.xp ?? 0;
    let finalLevel = reward?.level ?? 1;

    if (samples.length > 0 && horizonMs > 0) {
      const lastSample = samples[samples.length - 1];
      if (lastSample.skills) {
        for (const [sName, sData] of Object.entries(lastSample.skills)) {
          if (sName.toLowerCase() === skill.toLowerCase()) {
            const sd = sData as { level: number; xp: number };
            finalXp = sd.xp;
            finalLevel = sd.level;
            break;
          }
        }
      }
    }

    // Slim down samples: only keep elapsedMs and the target skill's data
    const slimSamples = samples.map(s => {
      const slimSkills: Record<string, { level: number; xp: number }> = {};
      if (s.skills) {
        for (const [sName, sData] of Object.entries(s.skills)) {
          if (sName.toLowerCase() === skill.toLowerCase()) {
            slimSkills[sName] = sData as { level: number; xp: number };
            break;
          }
        }
      }
      return { elapsedMs: s.elapsedMs, skills: slimSkills };
    });

    if (!combined[model]) combined[model] = {};

    const existing = combined[model][skill];
    const shouldReplace = !existing
      || (samples.length > existing.sampleCount * 2)
      || (existing.sampleCount <= samples.length * 2 && finalXp > existing.finalXp);
    if (shouldReplace) {
      combined[model][skill] = {
        jobName,
        finalXp,
        finalLevel,
        durationSeconds,
        sampleCount: samples.length,
        samples: slimSamples,
        ...(tokenUsage ? { tokenUsage } : {}),
        ...(trajectory ? { trajectory: trajectory.steps } : {}),
        ...(trimmedCount > 0 ? { trimmedSamples: trimmedCount } : {}),
      };
    }

    const tokenStr = tokenUsage ? `, tokens: ${(tokenUsage.inputTokens / 1000).toFixed(0)}k in / ${(tokenUsage.outputTokens / 1000).toFixed(0)}k out` : '';
    const trimStr = trimmedCount > 0 ? ` (trimmed ${trimmedCount} post-horizon samples)` : '';
    console.log(`  ${model}/${skill}: ${jobName} — xp=${finalXp}, level=${finalLevel}, ${samples.length} samples${trimStr}${tokenStr}`);
    extracted++;
  }
}

if (extracted === 0) {
  console.log(`\nNo skill-xp-${HORIZON} data found in any job directories.`);
  process.exit(1);
}

writeResults(RESULTS_DIR, combined, 'COMBINED_DATA');

// Write per-model JSON files
for (const [model, skills] of Object.entries(combined)) {
  const modelPath = join(RESULTS_DIR, `${model}.json`);
  writeFileSync(modelPath, JSON.stringify({ model, skills }, null, 2));
}

// ── Diagnostics ──────────────────────────────────────────────────

const expectedMinSamples = horizonMs > 0 ? Math.floor(horizonMs / 30000) : 0; // rough: one sample per 30s

console.log(`\n── Diagnostics ──`);
for (const [model, skills] of Object.entries(combined)) {
  const skillEntries = Object.entries(skills);
  const withData = skillEntries.filter(([, v]) => v.sampleCount > 0).length;
  const trimmedEntries = skillEntries.filter(([, v]) => (v as any).trimmedSamples > 0);
  const shortEntries = expectedMinSamples > 0
    ? skillEntries.filter(([, v]) => v.sampleCount > 0 && v.sampleCount < expectedMinSamples * 0.5)
    : [];

  console.log(`  ${model}: ${skillEntries.length} skills, ${withData} with tracking data`);
  if (trimmedEntries.length > 0) {
    for (const [sk, v] of trimmedEntries) {
      console.log(`    ⚠ ${sk}: ${(v as any).trimmedSamples} samples trimmed (orphaned scripts ran past horizon)`);
    }
  }
  if (shortEntries.length > 0) {
    for (const [sk, v] of shortEntries) {
      console.log(`    ⚠ ${sk}: only ${v.sampleCount} samples (expected ~${expectedMinSamples}+, possible early sandbox death)`);
    }
  }
}

console.log(`\n${extracted} result(s) extracted. View: open views/graph-skills.html?horizon=${HORIZON}`);
