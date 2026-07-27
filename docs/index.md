---
layout: home

hero:
  name: pi-ccg
  text: Bounded multi-agent workflows for Pi CLI
  tagline: Let Pi inspect, plan, build, test, review, and target repairs without unbounded agent fanout.
  actions:
    - theme: brand
      text: Install
      link: /guide/installation
    - theme: alt
      text: Workflow architecture
      link: /guide/workflow

features:
  - title: Pi-only supervisor
    details: Pi remains the sole controller and launches intelligent agents only when the project plan requires them.
  - title: Bounded dynamic fanout
    details: Builder count is constrained by development, global concurrency, parallel task, depth, and session spawn limits.
  - title: Role-specific models
    details: Configure frontend, backend, and review/test model routes independently.
  - title: Automated verification
    details: Tests and independent review run after builders, with component-targeted repair for failures.
---

## Quick start

```bash
npx pi-ccg init
ccg
```

Requirements: Node.js 20 or newer and an installed Pi CLI environment.
