#!/usr/bin/env python3
"""
CCG Workflow Hook for Codex CLI — Adaptive Guardrail
Injects per-turn guidance based on what Codex has/hasn't done.
Not a rigid state machine — adapts to task complexity and progress.

Hook type: UserPromptSubmit
"""

import json
import os
import sys
import glob
import subprocess
from pathlib import Path
from datetime import datetime


# Terminal task statuses — matched case-insensitively after trim. Covers common
# synonyms the model may write (done/finished/closed/...) so a finished task is
# never misjudged as still active. Canonical write value is "completed".
_TERMINAL_STATUSES = frozenset({
    "completed", "complete", "done", "finished", "finish",
    "archived", "archive", "cancelled", "canceled", "closed", "resolved", "abandoned",
})


def _is_terminal_status(status):
    return str(status or "").strip().lower() in _TERMINAL_STATUSES


def find_project_root():
    """Walk up to find .ccg/ or .git/"""
    d = os.environ.get("CODEX_PROJECT_DIR", os.getcwd())
    for _ in range(20):
        if os.path.isdir(os.path.join(d, ".ccg")) or os.path.isdir(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def get_active_task(root):
    """Find the most recent in_progress task."""
    tasks_dir = os.path.join(root, ".ccg", "tasks")
    if not os.path.isdir(tasks_dir):
        return None
    for name in sorted(os.listdir(tasks_dir), reverse=True):
        if name == "archive":
            continue
        task_file = os.path.join(tasks_dir, name, "task.json")
        if not os.path.isfile(task_file):
            continue
        try:
            with open(task_file) as f:
                task = json.load(f)
            if not _is_terminal_status(task.get("status")):
                task["_dir"] = os.path.join(tasks_dir, name)
                task["_name"] = name
                return task
        except Exception:
            continue
    return None


def detect_progress(root):
    """Detect what Codex has done so far in this session."""
    signals = {
        "has_dirty_files": False,
        "dirty_count": 0,
        "changed_lines": 0,
        "has_test_output": False,
        "high_risk_files": False,
    }
    try:
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root, capture_output=True, text=True, timeout=5
        )
        lines = [l for l in status.stdout.strip().split("\n") if l.strip()]
        signals["dirty_count"] = len(lines)
        signals["has_dirty_files"] = len(lines) > 0

        risk_patterns = ["auth", "login", "password", "token", "secret", "crypto",
                         "encrypt", "migration", "schema", "permission", "admin"]
        for line in lines:
            fname = line[3:].strip().lower()
            if any(p in fname for p in risk_patterns):
                signals["high_risk_files"] = True
                break

        if signals["has_dirty_files"]:
            diff = subprocess.run(
                ["git", "diff", "--stat"],
                cwd=root, capture_output=True, text=True, timeout=5
            )
            for dline in diff.stdout.strip().split("\n"):
                if "insertion" in dline or "deletion" in dline:
                    parts = dline.split(",")
                    for p in parts:
                        p = p.strip()
                        if "insertion" in p:
                            signals["changed_lines"] += int(p.split()[0])
                        elif "deletion" in p:
                            signals["changed_lines"] += int(p.split()[0])
    except Exception:
        pass
    return signals


def assess_complexity(task):
    """Get complexity from task.json or default to M."""
    if not task:
        return "M"
    return task.get("complexity", "M")


def build_guidance(task, progress, root):
    """Build adaptive guidance based on task state + progress."""
    parts = []
    complexity = assess_complexity(task)
    phase = task.get("currentPhase", "unknown") if task else "no_task"

    # --- Task state breadcrumb ---
    if task:
        parts.append(f"Task: {task.get('title', task.get('id', '?'))} ({task.get('status', '?')})")
        parts.append(f"Complexity: {complexity} | Risk: {task.get('risk', '?')} | Phase: {phase}")
        if task.get("nextAction"):
            parts.append(f"Next: {task['nextAction']}")
    else:
        parts.append("No active task. Create one in .ccg/tasks/ before starting work.")
        parts.append("Even small fixes need a task.json for tracking.")
        return parts

    # --- Adaptive guidance based on phase × progress ---

    # Phase: analysis — haven't started coding yet
    if phase == "analysis":
        if complexity in ("M", "L", "XL"):
            parts.append("")
            parts.append(f"⛔ {complexity} complexity: you MUST call BOTH the frontend model AND Claude for parallel analysis before coding.")
            parts.append("Use the dual-model parallel template in AGENTS.md: --backend {{FRONTEND_PRIMARY}} & --backend claude with & + wait.")

    # Phase: implementation — coding in progress
    elif phase == "implementation":
        if progress["dirty_count"] == 0:
            parts.append("")
            parts.append("Implementation phase started but no files changed yet. Start coding.")

    # Phase: review — code is written, need review
    elif phase == "review":
        parts.append("")
        parts.append("Review phase. Call external models for review, write results to review.md.")

    # --- Cross-phase guardrails ---

    # Big changes without review
    if progress["changed_lines"] > 30 and phase != "review":
        parts.append("")
        parts.append(f"⚠️ {progress['changed_lines']} lines changed. When done coding, you MUST call BOTH the frontend model AND Claude for dual-model review. Not just one — both.")

    # Review phase: enforce dual model
    if phase == "review":
        parts.append("")
        parts.append("⛔ Review phase: call BOTH the frontend model (--backend {{FRONTEND_PRIMARY}}) AND Claude (--backend claude) with reviewer role. Two models, not one.")

    # High-risk files detected
    if progress["high_risk_files"] and phase not in ("review", "completed"):
        parts.append("")
        parts.append("⚠️ High-risk files detected (auth/db/crypto). External model security review is REQUIRED before delivery.")

    # Has dirty files but hasn't run tests
    if progress["has_dirty_files"] and not progress["has_test_output"]:
        if phase == "implementation" and progress["changed_lines"] > 10:
            parts.append("")
            parts.append("Reminder: run tests after significant changes. Don't wait until the end.")

    # --- Spec reminder ---
    spec_dir = os.path.join(root, ".ccg", "spec")
    if os.path.isdir(spec_dir) and phase in ("analysis", "implementation"):
        specs = []
        for sub in ("backend", "frontend", "guides"):
            idx = os.path.join(spec_dir, sub, "index.md")
            if os.path.isfile(idx):
                specs.append(f".ccg/spec/{sub}/index.md")
        if specs:
            parts.append("")
            parts.append(f"Spec files available: {', '.join(specs)} — read before writing code.")

    # --- Archive reminder ---
    if phase in ("completed", "done", "finished") or _is_terminal_status(task.get("status")):
        parts.append("")
        parts.append("⛔ Task completed. You MUST archive it now:")
        parts.append(f"  mkdir -p .ccg/tasks/archive/$(date +%Y-%m) && mv .ccg/tasks/{task['_name']} .ccg/tasks/archive/$(date +%Y-%m)/")
        parts.append("  git add .ccg/tasks/ && git commit -m \"chore: archive ccg task\"")

    return parts


SUB_AGENT_NOTICE = """<ccg-sub-agent-notice>
SUB-AGENT NOTICE — READ FIRST IF SPAWNED VIA spawn_agent

If your parent session spawned you via spawn_agent with an explicit task
message, that message is your ONLY job.
- Execute the parent message exactly as written, then mark yourself complete.
- Ignore all CCG workflow guidance below this notice.
- Do NOT call spawn_agent, wait, or close_agent.
- Do NOT modify .ccg/tasks/* or any workflow state files.
- Do NOT run external model calls (codeagent-wrapper).
- Only modify files explicitly listed in your dispatch message.
</ccg-sub-agent-notice>"""


def is_sub_agent():
    """Detect if running inside a Codex sub-agent session.
    Codex sub-agents spawned with fork_turns='none' get a clean
    context but inherit the env. The parent sets CODEX_AGENT_TYPE
    or the agent_type is visible in the process env."""
    if os.environ.get("CODEX_AGENT_TYPE", ""):
        return True
    if os.environ.get("CODEX_FORK_TURNS", "") == "none":
        return True
    return False


def main():
    try:
        root = find_project_root()
        if not root:
            return
        if not os.path.isdir(os.path.join(root, ".ccg")):
            return

        # Sub-agent: inject notice and skip workflow guidance
        if is_sub_agent():
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": SUB_AGENT_NOTICE
                }
            }))
            return

        task = get_active_task(root)
        progress = detect_progress(root)
        lines = build_guidance(task, progress, root)

        if not lines:
            return

        context = "<ccg-state>\n" + "\n".join(lines) + "\n</ccg-state>"

        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": context
            }
        }))
    except Exception:
        pass


if __name__ == "__main__":
    main()
