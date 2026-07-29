import { readFileSync } from 'node:fs'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'

describe('npm publish workflow contract', () => {
  it('uses trusted publishing without long-lived npm tokens', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'npm-publish.yml'),
      'utf-8',
    )

    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('environment: npm')
    expect(workflow).toContain('runs-on: ubuntu-latest')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('npm pack --dry-run --json')
    expect(workflow).toContain('npm publish --access public --provenance')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN')
    expect(workflow).not.toContain('NPM_TOKEN')
  })
})
