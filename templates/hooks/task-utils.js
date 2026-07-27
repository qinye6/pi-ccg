#!/usr/bin/env node
// CCG Hook Shared Utilities
// Pure Node.js, zero external dependencies

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.ccg', 'tasks'))) return dir;
    if (fs.existsSync(path.join(dir, '.ccg'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Terminal task statuses — a task in any of these is no longer active, so the
// hooks stop injecting its breadcrumb. Matched case-insensitively after trim,
// covering common synonyms the model may write (done/finished/closed/...) so a
// committed-and-finished task is never misjudged as still in progress. The
// canonical write-side value is "completed" (see go.md), but the read side must
// be forgiving because status is free-text written by the model.
const TERMINAL_STATUSES = new Set([
  'completed', 'complete', 'done', 'finished', 'finish',
  'archived', 'archive', 'cancelled', 'canceled', 'closed', 'resolved', 'abandoned'
]);

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status == null ? '' : status).trim().toLowerCase());
}

function getActiveTask(projectRoot) {
  const tasksDir = path.join(projectRoot, '.ccg', 'tasks');
  if (!fs.existsSync(tasksDir)) return null;

  try {
    const dirs = fs.readdirSync(tasksDir)
      .filter(d => {
        if (d === 'archive') return false;
        try {
          const full = path.join(tasksDir, d);
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'task.json'));
        } catch { return false; }
      })
      .sort()
      .reverse();

    for (const dir of dirs) {
      try {
        const taskPath = path.join(tasksDir, dir, 'task.json');
        if (!fs.existsSync(taskPath)) continue; // stale pointer detection
        const raw = fs.readFileSync(taskPath, 'utf-8');
        const task = JSON.parse(raw);
        if (!isTerminalStatus(task.status)) {
          return { dir: path.join(tasksDir, dir), ...task, _stale: false };
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* silent */ }
  return null;
}

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function readContextJsonl(taskDir) {
  const jsonlPath = path.join(taskDir, 'context.jsonl');
  if (!fs.existsSync(jsonlPath)) return [];
  try {
    return fs.readFileSync(jsonlPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(entry => entry && entry.file);
  } catch { return []; }
}

function detectTechStack(projectRoot) {
  const indicators = [
    { file: 'package.json', stack: 'Node.js' },
    { file: 'go.mod', stack: 'Go' },
    { file: 'pyproject.toml', stack: 'Python' },
    { file: 'Cargo.toml', stack: 'Rust' },
    { file: 'pom.xml', stack: 'Java' },
    { file: 'build.gradle', stack: 'Java/Kotlin' },
  ];
  const found = [];
  for (const { file, stack } of indicators) {
    if (fs.existsSync(path.join(projectRoot, file))) found.push(stack);
  }
  return found.length > 0 ? found.join(' + ') : 'Unknown';
}

function getGitInfo(projectRoot) {
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, stdio: 'pipe' }).toString().trim();
    const status = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' }).toString().trim();
    const dirtyCount = status ? status.split('\n').length : 0;
    return { branch, dirtyCount };
  } catch { return { branch: 'unknown', dirtyCount: 0 }; }
}

// outputHook(event, additionalContext)           → inject context into the CALLING session
// outputHook(event, null, { updatedInput, ... })  → rewrite the tool input before it runs
//   `extra` is merged into hookSpecificOutput, so it can carry updatedInput /
//   permissionDecision / permissionDecisionReason. Pass additionalContext = null
//   to omit it. Back-compatible: existing 2-arg calls behave exactly as before.
function outputHook(eventName, additionalContext, extra) {
  const hookSpecificOutput = { hookEventName: eventName };
  if (additionalContext != null && additionalContext !== '') {
    hookSpecificOutput.additionalContext = additionalContext;
  }
  if (extra && typeof extra === 'object') {
    Object.assign(hookSpecificOutput, extra);
  }
  console.log(JSON.stringify({ hookSpecificOutput }));
}

function archiveTask(taskDir, projectRoot) {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const archiveDir = path.join(projectRoot, '.ccg', 'tasks', 'archive', month);
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const name = path.basename(taskDir);
    const dest = path.join(archiveDir, name);
    fs.renameSync(taskDir, dest);
    return dest;
  } catch { return null; }
}

function autoCommitTask(projectRoot, message) {
  try {
    const { execSync } = require('child_process');
    execSync('git add .ccg/tasks/', { cwd: projectRoot, stdio: 'pipe' });
    const diff = execSync('git diff --cached --quiet', { cwd: projectRoot, stdio: 'pipe' }).toString();
    return false; // nothing to commit
  } catch {
    try {
      const { execSync } = require('child_process');
      execSync(`git commit -m "${message || 'chore: archive ccg task'}"`, { cwd: projectRoot, stdio: 'pipe' });
      return true;
    } catch { return false; }
  }
}

function seedContextJsonl(taskDir, projectRoot) {
  const jsonlPath = path.join(taskDir, 'context.jsonl');
  if (fs.existsSync(jsonlPath)) return;
  const specDir = path.join(projectRoot, '.ccg', 'spec');
  const lines = ['{"_example": "Fill with {\\\"file\\\": \\\"path\\\", \\\"reason\\\": \\\"why\\\"}. One entry per line. Seed rows (with _example key) are skipped."}'];
  if (fs.existsSync(specDir)) {
    try {
      const walk = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(dir, e.name), rel);
          else if (e.name.endsWith('.md')) lines.push(JSON.stringify({ file: `.ccg/spec/${rel}`, reason: 'project spec' }));
        }
      };
      walk(specDir, '');
    } catch { /* silent */ }
  }
  try { fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8'); } catch { /* silent */ }
}

function trackTurn(taskDir, phase, nextAction) {
  const turnsPath = path.join(taskDir, '.turns.json');
  let turns = [];
  try { turns = JSON.parse(fs.readFileSync(turnsPath, 'utf-8')); } catch { /* fresh */ }
  turns.push({ phase: phase || '', next: nextAction || '', ts: Date.now() });
  if (turns.length > 10) turns = turns.slice(-10);
  try { fs.writeFileSync(turnsPath, JSON.stringify(turns), 'utf-8'); } catch { /* silent */ }
  return turns;
}

function detectLoop(turns, threshold) {
  threshold = threshold || 3;
  if (turns.length < threshold) return null;
  const recent = turns.slice(-threshold);
  const key = `${recent[0].phase}|${recent[0].next}`;
  const allSame = recent.every(t => `${t.phase}|${t.next}` === key);
  if (!allSame) return null;
  const elapsed = (recent[recent.length - 1].ts - recent[0].ts) / 1000;
  return { phase: recent[0].phase, nextAction: recent[0].next, count: threshold, elapsedSec: Math.round(elapsed) };
}

module.exports = {
  findProjectRoot,
  getActiveTask,
  isTerminalStatus,
  readFileSafe,
  readJsonSafe,
  readContextJsonl,
  detectTechStack,
  getGitInfo,
  outputHook,
  archiveTask,
  autoCommitTask,
  seedContextJsonl,
  trackTurn,
  detectLoop
};
