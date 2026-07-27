# CCG Quality Gates — Auto-trigger Rules

When working in a project, automatically invoke the corresponding quality gate skills based on the scenario below. These skills are installed at `~/.claude/skills/ccg/` and can be called directly.

**IMPORTANT**: Quality gate skills are installed as `/ccg:*` commands. Use the full prefixed name: `/ccg:verify-security`, `/ccg:verify-quality`, `/ccg:verify-change`, `/ccg:verify-module`, `/ccg:gen-docs`.

## Trigger Rules

### New Module Created

When a new module/package/directory is created with source code:

```
/ccg:gen-docs <module-path>        → Generate README.md + DESIGN.md skeleton
  ↓ (after development)
/ccg:verify-module <module-path>   → Check structure completeness
  ↓
/ccg:verify-security <module-path> → Scan for security vulnerabilities
```

### Code Changes > 30 Lines

When a single task produces code changes exceeding 30 lines:

```
/ccg:verify-change                 → Analyze change impact, check doc sync
  ↓
/ccg:verify-quality <changed-path> → Check complexity, code smells, naming
```

### Security-Related Changes

When changes involve authentication, authorization, encryption, input validation, or secrets management:

```
/ccg:verify-security <changed-path> → Scan for vulnerabilities
```

### Refactoring

When refactoring existing code:

```
/ccg:verify-change                  → Ensure docs reflect the refactoring
  ↓
/ccg:verify-quality <refactored-path> → Verify quality improved
  ↓
/ccg:verify-security <refactored-path> → No new vulnerabilities introduced
```

## Execution Rules

1. **Non-blocking** — Quality gates produce reports but do NOT block delivery unless Critical issues are found
2. **Chainable** — Run gates in the order specified above; skip if previous gate fails
3. **Silent on pass** — Only report findings; do not output "all clear" messages for every gate
4. **Critical = must fix** — Only `Critical` / `High` severity findings require action before delivery
5. **Idempotent** — Safe to re-run; same input produces same output

## Multi-Agent Coordination

When a task involves 3+ independent files/modules or 2+ parallel workflows, refer to the multi-agent orchestration skill at `~/.claude/skills/ccg/orchestration/multi-agent/SKILL.md` for:

- Agent role assignment (Lead / Scout / Worker / Soldier / Drone)
- File ownership locking (one writer per file at any time)
- Task decomposition strategy (by file, by module, or by pipeline)
