# Cookie 保险库

按站点分区记录历史 cookie，供抓取时快速查找使用。

> **安全提示**: 此文件存储敏感 cookie 值，请勿提交到版本控制或分享给他人。
> 实际使用时，请将此文件复制为 `cookie-vault.local.md` 并填入真实值。

---

## 示例站点 (example.com)

**最后更新**: YYYY-MM-DD
**状态**: 有效 / 可能已过期
**登录 cookie 字段**: `session_id`, `auth_token`
**Fetcher 类型**: StealthyFetcher

### Playwright 格式（StealthyFetcher/DynamicFetcher 用）

```python
cookies = [
    {'name': 'session_id', 'value': '<YOUR_SESSION_ID>', 'domain': '.example.com', 'path': '/'},
    {'name': 'auth_token', 'value': '<YOUR_AUTH_TOKEN>', 'domain': '.example.com', 'path': '/'},
]
```

### 备注

- 从浏览器 DevTools > Application > Cookies 获取真实值
- cookie 有效期取决于站点设置，过期后需重新获取

---

## 模板：添加新站点

复制以下模板，替换具体内容后追加到此文件：

```markdown
## 站点名称 (域名)

**最后更新**: YYYY-MM-DD
**状态**: 有效 / 可能已过期
**登录 cookie 字段**: `field1`, `field2`
**Fetcher 类型**: Fetcher / StealthyFetcher / DynamicFetcher

### Playwright 格式

\```python
cookies = [
    {'name': 'field1', 'value': '...', 'domain': '.example.com', 'path': '/'},
]
\```

### 备注

- 相关注意事项
```
