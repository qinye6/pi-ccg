#!/usr/bin/env node
// CCG SubAgent Context Hook — PreToolUse (Bash|Agent matcher)
// Injects spec + task context when:
//   1. codeagent-wrapper is about to be called (Bash)
//   2. Agent Team member is about to be spawned (Agent)
// Supports role-based filtering: context.jsonl entries with "roles" field
// are only injected when the agent's detected role matches.

'use strict';

try {
  const path = require('path');
  const fs = require('fs');
  const {
    findProjectRoot, getActiveTask, readFileSafe,
    readContextJsonl, outputHook
  } = require('./task-utils.js');

  let inputData = '';
  if (!process.stdin.isTTY) {
    inputData = fs.readFileSync(0, 'utf-8');
  }

  let toolInput = {};
  try {
    const parsed = JSON.parse(inputData);
    toolInput = parsed.tool_input || parsed.input || parsed;
  } catch { /* not JSON */ }

  // Determine trigger type
  const command = toolInput.command || '';
  const teamName = toolInput.team_name || '';
  const agentName = toolInput.name || '';

  const isCodeagentCall = command.includes('codeagent-wrapper');
  const isTeamSpawn = !!teamName;

  if (!isCodeagentCall && !isTeamSpawn) {
    process.exit(0);
  }

  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(cwd);
  if (!root) process.exit(0);

  const task = getActiveTask(root);
  if (!task) process.exit(0);

  // --- Role detection ---
  const ROLE_FILE_MAP = {
    'reviewer': 'review',
    'analyzer': 'research',
    'debugger': 'debug',
    'tester': 'review',
    'architect': 'implement',
    'optimizer': 'implement',
    'frontend': 'implement'
  };
  const AGENT_NAME_PATTERNS = [
    { pattern: /dev|builder|fix|impl/i, role: 'implement' },
    { pattern: /review|check|audit/i, role: 'review' },
    { pattern: /research|scout|explore|analy/i, role: 'research' },
    { pattern: /debug|diagnos/i, role: 'debug' }
  ];

  let detectedRole = 'implement'; // default

  if (isCodeagentCall) {
    const roleMatch = command.match(/ROLE_FILE:.*\/(\w+)\.md/);
    if (roleMatch) {
      detectedRole = ROLE_FILE_MAP[roleMatch[1]] || 'implement';
    }
  } else if (isTeamSpawn && agentName) {
    for (const { pattern, role } of AGENT_NAME_PATTERNS) {
      if (pattern.test(agentName)) {
        detectedRole = role;
        break;
      }
    }
  }

  const contextParts = [];

  if (isTeamSpawn) {
    contextParts.push(`<ccg-active-task>
Active task: ${task.dir}
Task: ${task.title || task.id} (${task.status})
Strategy: ${task.strategy}
Phase: ${task.currentPhase}
Agent role: ${detectedRole}
</ccg-active-task>`);
  }

  // Read context.jsonl with role-based filtering
  const allEntries = readContextJsonl(task.dir);
  const entries = allEntries.filter(entry => {
    if (!entry.roles || !Array.isArray(entry.roles) || entry.roles.length === 0) {
      return true; // no roles field = inject to all
    }
    return entry.roles.includes(detectedRole) || entry.roles.includes('all');
  });

  if (entries.length > 0) {
    const specContents = [];
    for (const entry of entries) {
      const filePath = path.isAbsolute(entry.file)
        ? entry.file
        : path.join(root, entry.file);
      const content = readFileSafe(filePath);
      if (content) {
        specContents.push(`--- ${entry.file} (${entry.reason || 'context'}) ---\n${content}`);
      }
    }
    if (specContents.length > 0) {
      contextParts.push(`<ccg-specs>\n${specContents.join('\n\n')}\n</ccg-specs>`);
    }
  }

  // Read PRD and plan (always inject, role-independent)
  const prd = readFileSafe(path.join(task.dir, 'requirements.md'));
  const plan = readFileSafe(path.join(task.dir, 'plan.md'));

  if (prd || plan) {
    const taskContext = ['<ccg-task-context>'];
    if (prd) {
      const prdSummary = prd.length > 2000 ? prd.substring(0, 2000) + '\n...(truncated)' : prd;
      taskContext.push(`## Requirements\n${prdSummary}`);
    }
    if (plan) {
      const planSummary = plan.length > 3000 ? plan.substring(0, 3000) + '\n...(truncated)' : plan;
      taskContext.push(`## Plan\n${planSummary}`);
    }
    taskContext.push('</ccg-task-context>');
    contextParts.push(taskContext.join('\n'));
  }

  // Read research files (only for research + implement roles)
  if (detectedRole === 'research' || detectedRole === 'implement') {
    const researchDir = path.join(task.dir, 'research');
    if (fs.existsSync(researchDir)) {
      try {
        const researchFiles = fs.readdirSync(researchDir).filter(f => f.endsWith('.md'));
        if (researchFiles.length > 0) {
          const researchContents = researchFiles.map(f => {
            const content = readFileSafe(path.join(researchDir, f));
            return content ? `--- research/${f} ---\n${content.substring(0, 1500)}` : null;
          }).filter(Boolean);
          if (researchContents.length > 0) {
            contextParts.push(`<ccg-research>\n${researchContents.join('\n\n')}\n</ccg-research>`);
          }
        }
      } catch { /* silent */ }
    }
  }

  if (contextParts.length === 0) process.exit(0);

  const injected = `<ccg-injected-context>\n${contextParts.join('\n\n')}\n</ccg-injected-context>`;

  // Agent/Team spawn: rewrite the spawned teammate's OWN prompt via updatedInput.
  // A PreToolUse hook's additionalContext only reaches the CALLING (lead) session,
  // which the not-yet-created subagent can never read. updatedInput replaces the
  // entire tool input, so we spread toolInput to keep subagent_type/name/team_name/
  // model intact and only prepend the spec to `prompt`. The teammate is born with
  // the spec already in its prompt. (Docs: PreToolUse → updatedInput.)
  if (isTeamSpawn && typeof toolInput.prompt === 'string') {
    outputHook('PreToolUse', null, {
      updatedInput: { ...toolInput, prompt: `${injected}\n\n---\n\n${toolInput.prompt}` }
    });
  } else {
    // Bash / codeagent-wrapper: the lead builds the HEREDOC task text itself, so the
    // spec belongs in the lead's context where it can be woven into the command.
    outputHook('PreToolUse', injected);
  }
} catch {
  process.exit(0);
}
