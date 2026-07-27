# Agent reference

| Agent | Role | Memory |
|---|---|---|
| `ccg-project-scout` | Read-only project and component discovery | Pi project memory |
| `ccg-planner` | Component plan, ownership, dependencies, and test plan | Pi project memory |
| `ccg-backend-builder` | Backend and service implementation | Pi project memory |
| `ccg-frontend-builder` | Web frontend and administration UI implementation | Pi project memory |
| `ccg-miniprogram-builder` | WeChat mini-program implementation | Pi project memory |
| `ccg-test-runner` | Test, typecheck, lint, and build execution | Stateless |
| `ccg-reviewer` | Independent correctness, quality, and security review | Stateless |

All CCG agents use fresh context. The Pi supervisor must inline the required plan and prior result into each task rather than relying on another agent run's conversation history.

The planner assigns a stable `componentId` and one owning builder to each component. Test and review results use the same ID so repair requests can be routed without reopening unrelated scopes.
