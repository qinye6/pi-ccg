# Frontend Spec — 前端编码规范

> 本文件定义前端代码的编码规范。子 Agent 在写代码前会自动读取此文件。
> 按项目实际情况修改内容。

## 组件规范

- 组件命名: PascalCase
- 文件结构: 一个组件一个文件
- Props: TypeScript 接口定义，必须有类型
- 状态: 优先 local state，跨组件共享用 store

## 样式规范

- 方案: CSS Modules / Tailwind / styled-components（按项目选择）
- 命名: BEM 或 utility-first
- 响应式: mobile-first
- 主题: 使用 CSS 变量 / design tokens

## 可访问性

- [ ] 语义化 HTML（button 不用 div）
- [ ] ARIA 标签（交互元素必须有 label）
- [ ] 键盘导航（Tab 序和 Focus 管理）
- [ ] 颜色对比度 > 4.5:1

## 性能

- 图片: 使用 lazy loading + 合适格式（WebP）
- 包大小: 关注 bundle analyzer，避免大依赖
- 渲染: 避免不必要的 re-render
