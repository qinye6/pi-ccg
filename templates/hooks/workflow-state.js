#!/usr/bin/env node
// CCG Workflow State Hook — UserPromptSubmit
// Injects per-turn breadcrumb based on active task state.
// Includes loop detection: warns when same phase+nextAction repeats 3+ turns.
// Runs on EVERY user message. Must be fast (<1s) and never crash.

'use strict';

try {
  const { findProjectRoot, getActiveTask, outputHook, trackTurn, detectLoop } = require('./task-utils.js');

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);

  if (!root) process.exit(0);

  const task = getActiveTask(root);

  if (!task) {
    process.exit(0);
  }

  const turns = trackTurn(task.dir, task.currentPhase, task.nextAction);
  const loop = detectLoop(turns, 3);

  const lines = [
    '<ccg-state>',
    `Task: ${task.title || task.id} (${task.status})`,
    `Strategy: ${task.strategy}`,
    `Phase: ${task.currentPhase}`,
  ];

  if (task.gate) {
    lines.push(`⛔ GATE: ${task.gate}`);
  }

  lines.push(`Next: ${task.nextAction || 'Continue current phase'}`);

  if (loop) {
    lines.push('');
    lines.push(`⚠️ LOOP DETECTED: Phase "${loop.phase}" with same nextAction repeated ${loop.count} turns (${loop.elapsedSec}s).`);
    lines.push('🔄 BREAK-LOOP PROTOCOL:');
    lines.push('  1. STOP current approach immediately');
    lines.push('  2. Root-cause analysis: why is this phase not progressing?');
    lines.push('  3. Options: (a) try alternative approach, (b) escalate to user, (c) upgrade strategy');
    lines.push('  4. If blocked by external dependency → tell user explicitly');
    lines.push('  5. Do NOT repeat the same action — that is what caused this loop');
  }

  lines.push('</ccg-state>');

  outputHook('UserPromptSubmit', lines.join('\n'));
} catch {
  process.exit(0);
}
