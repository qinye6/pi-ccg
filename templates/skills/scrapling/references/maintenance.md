# Scrapling 安装与维护

## 安装层级

| 安装命令 | 包含内容 |
|---------|---------|
| `pip install scrapling` | 仅核心解析器（Selector），无网络抓取能力 |
| `pip install "scrapling[fetchers]"` | + Fetcher/StealthyFetcher/DynamicFetcher（curl_cffi, Playwright, Camoufox） |
| `pip install "scrapling[ai]"` | + AI 功能（transformers） |
| `pip install "scrapling[shell]"` | + 交互式 shell |
| `pip install "scrapling[all]"` | 全部功能 |

**推荐**: 大多数场景使用 `scrapling[fetchers]` 即可。

## 检查安装状态

```bash
# 查看版本
pip show scrapling

# 验证基础包可用
python -c "from scrapling.parser import Selector; print('Parser OK')"

# 验证 Fetcher 可用（需要 [fetchers]）
python -c "from scrapling.fetchers import Fetcher; print('Fetcher OK')"

# 验证 StealthyFetcher 可用
python -c "from scrapling.fetchers import StealthyFetcher; print('StealthyFetcher OK')"

# 验证 DynamicFetcher 可用
python -c "from scrapling.fetchers import DynamicFetcher; print('DynamicFetcher OK')"
```

## 安装浏览器依赖

StealthyFetcher 和 DynamicFetcher 需要浏览器引擎，安装后需执行:

```bash
# 方式 1: 直接命令（PATH 包含 Scripts 目录时）
scrapling install

# 方式 2: 通过 Python 调用（推荐，避免 PATH 问题）
python -c "from scrapling.cli import main; main(['install'])"
```

## 升级

```bash
pip install --upgrade "scrapling[fetchers]"
```

升级后建议重新验证三个 Fetcher 是否可用（见上方检查命令）。

## 三 Fetcher 完整验证脚本

```python
#!/usr/bin/env python3
"""验证 scrapling 三个 Fetcher 均可正常使用"""
import scrapling

print(f"scrapling version: {scrapling.__version__}")

# 1. Fetcher (curl_cffi)
from scrapling.fetchers import Fetcher
page = Fetcher.get("https://httpbin.org/get", impersonate='chrome', timeout=15)
print(f"Fetcher: status={page.status}")

# 2. StealthyFetcher (Camoufox)
from scrapling.fetchers import StealthyFetcher
page = StealthyFetcher.fetch("https://httpbin.org/get", headless=True, timeout=30000)
print(f"StealthyFetcher: status={page.status}")

# 3. DynamicFetcher (Playwright)
from scrapling.fetchers import DynamicFetcher
page = DynamicFetcher.fetch("https://httpbin.org/get", headless=True, timeout=30000)
print(f"DynamicFetcher: status={page.status}")

print("\nAll Fetchers verified successfully")
```
