import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'pi-ccg',
  description: 'Bounded multi-agent development workflows for Pi CLI',
  base: '/pi-ccg/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/installation' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'GitHub', link: 'https://github.com/qinye6/pi-ccg' },
      { text: 'npm', link: 'https://www.npmjs.com/package/pi-ccg' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Workflow', link: '/guide/workflow' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Agents', link: '/reference/agents' },
          { text: 'Security', link: '/reference/security' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/qinye6/pi-ccg' },
    ],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © pi-ccg contributors',
    },
  },
})
