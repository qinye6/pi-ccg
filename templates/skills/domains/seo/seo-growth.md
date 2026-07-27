# SEO Growth Engine — Multi-Locale Content & Optimization Skill

> Full-cycle SEO workflow: GSC analysis → keyword research → title optimization →
> content creation → batch translation → validation → internal linking → deploy.
> Applicable to any multi-locale static site with markdown-based blog.

## When to use

Trigger keywords: SEO, 曝光, 点击率, CTR, 关键词, 踩词, 优化标题, 写博客, 翻译文章,
搜索排名, GSC, Search Console, seoTitle, 内链, 长尾词, 竞品分析

## Prerequisites

- **Search MCP** (grok, exa, or equivalent) for keyword research
- **Translation API** (any OpenAI-compatible endpoint: grok-4.5, GPT, etc.)
- **Frontmatter parser** (gray-matter for JS projects, or python-frontmatter)
- **Markdown blog** with locale directories (`content/blog/{locale}/{slug}.md`)
- Frontmatter schema should include: `title`, `seoTitle`, `description`, `date`, `updated`, `image`, `relatedSlugs`

## Phase 1: GSC Data Analysis (Diagnose)

**Automated script:** `scripts/gsc-report.py` (see README.md for GSC API setup)

```bash
python3 scripts/gsc-report.py              # 7-day report, auto-categorized
python3 scripts/gsc-report.py --days 28 --pages   # 28-day with page breakdown
python3 scripts/gsc-report.py --json        # JSON for piping to other tools
```

The script auto-pulls GSC data via API, groups by language, and generates 5 action categories:
- **Zero Clicks, High Impressions** → title optimization targets
- **Striking Distance (pos 8-20)** → push to page 1 with internal links
- **Winners** → protect and expand
- **Deep Buried (pos 30+)** → needs new content or backlinks
- **Top Pages** → identifies zero-click pages

**If GSC API is not configured**, user can provide screenshots or manual data instead.

**Actions after report:**
1. Group queries by language
2. Identify high-impression / zero-CTR queries (the biggest ROI targets)
3. Identify verb/phrasing mismatch between query and page title
4. Check if page title matches the writing system of the target locale

**Key patterns to detect:**
- **Script mismatch:** Non-Latin users search in their native script but title uses Latin (e.g., Korean users search "감마" but title shows "Gamma"). Google requires `<title>` to use the same writing system as the page content.
- **Verb mismatch:** Users search with a specific verb but title uses a synonym (e.g., ES "quitar" vs "eliminar", ID "menghilangkan" vs "menghapus").
- **Question format:** Users search "how to..." / "como..." but title is declarative.
- **Missing year:** Queries include the current year but title doesn't — adding year gives ~15% CTR lift.

**Output:** Priority-ranked list of title fixes + new content opportunities.

## Phase 2: Title Optimization (seoTitle)

### Critical decision rule
**If a seoTitle is already converting (has clicks), do NOT change the title verb.** Instead, add
synonym coverage in the `description` field. Changing a converting title risks losing established
rankings. Example: seoTitle uses "제거" (clicks exist) but users also search "없애기" → add "없애기"
to description, keep seoTitle unchanged.

### Universal rules
- **seoTitle formula (PBC):** Power word + Benefit + Curiosity, 40-60 chars.
- **Year stamp:** Always include current year for freshness signal.
- **Power words:** Free, Proven, Instant, Easy, Step-by-Step, Best, Complete, Guide.
- **Positive sentiment** titles outperform negative by ~4%.
- **Numbers** (especially odd: 7, 9) and brackets `[Free Tool]` boost CTR.

### Per-language localization rules

**Korean (ko):** Transliterate brand names to Hangul in seoTitle. Google requires title to match page's writing system. Industry standard: Google→구글, Apple→애플. Hangul titles fit ~25-30 chars before pixel truncation.

**Spanish (es):** Identify the dominant verb in GSC queries and match it. "Quitar" vs "eliminar" vs "borrar" — pick whichever appears most in actual search data. Include question form "Cómo [verb]..." for PAA match.

**Indonesian (id):** Cover multiple verb forms: "menghapus", "menghilangkan", "hilangkan" all mean "remove" but users search different forms.

**German (de):** Front-load the key noun phrase (e.g., "Wasserzeichen entfernen" before brand name). German searchers use precise compound terms.

**Arabic (ar):** Use Arabic transliteration for brand names in seoTitle (e.g., Gamma → جاما). Users search in Arabic script. Keep Latin brand name in parentheses for dual match: "جاما (Gamma)".

**Japanese (ja):** Mix kanji action words with katakana brand names (e.g., 透かし削除 + Brand).

**Chinese (zh):** Use concise 2-4 character action phrases (去除/删除/免费).

### Batch fix script pattern
```python
import re
from pathlib import Path

BLOG = Path("content/blog")
BRAND_LOCALIZATIONS = {
    "ko": {"BrandName": "브랜드네임"},  # Map English brand → local script
}

for lang, mappings in BRAND_LOCALIZATIONS.items():
    for f in sorted((BLOG / lang).glob("*.md")):
        text = f.read_text()
        for eng, local in mappings.items():
            if "seoTitle:" in text:
                text = re.sub(
                    rf'(seoTitle:\s*"[^"]*?){eng}([^"]*?")',
                    rf'\1{local}\2', text)
        f.write_text(text)
```

### Validation
After any batch seoTitle edit, always verify:
```bash
# Parse all articles, check required fields exist
node -e "
const matter = require('gray-matter'), fs = require('fs'), path = require('path');
let ok=0, bad=0;
for (const lang of fs.readdirSync('content/blog')) {
  const d = path.join('content/blog', lang);
  if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))) {
    try { const {data}=matter(fs.readFileSync(path.join(d,f),'utf8'));
      if(!data.title||!data.description||!data.date) throw new Error('missing field');
      ok++;
    } catch(e) { console.log('BAD: '+lang+'/'+f+': '+e.message); bad++; }
  }
}
console.log(ok+'/'+(ok+bad)+' OK');
"
```

## Phase 2b: Content Prioritization Matrix

Before creating new content, score each candidate keyword with this weighted matrix
(adapted from borghei/Claude-Skills):

| Factor | Weight | Score 1-5 | How to evaluate |
|--------|--------|-----------|-----------------|
| Business relevance | 30% | Does it lead users to your product? |  |
| Search volume | 25% | Monthly searches (use Search MCP or keyword tools) |  |
| Keyword difficulty | 20% | How strong are current top-10 pages? (invert: easy=5) |  |
| Competitive gap | 15% | Do competitors cover this poorly or not at all? |  |
| Asset reuse value | 10% | Can this content be repurposed (social, email, docs)? |  |

**Final score** = sum of (weight × score). Prioritize highest scores first.

**Decision thresholds:**
- Score > 3.5 → write immediately
- Score 2.5-3.5 → write when capacity allows
- Score < 2.5 → skip or defer

## Phase 2c: Topic Cluster Architecture

Organize content as **pillar + cluster** for topical authority:

```
                    [Pillar Page]
                   (2000-4000 words)
                  /    |    |     \
          [Spoke]  [Spoke] [Spoke] [Spoke]
        (800-1500 words each, bidirectional links)
```

**Rules:**
- 1 pillar page per core topic (e.g., "how to remove gamma watermark" = pillar)
- 10-25 supporting spoke articles per pillar
- Every spoke links to its pillar via in-content link + relatedSlugs
- Pillar links to all spokes via "Related guides" section
- Each spoke targets a unique long-tail keyword (no overlap with pillar)
- Update pillar page whenever a new spoke is published

**Mapping example:**
```
Pillar: "Complete guide to removing AI watermarks"
├── Spoke: "Remove watermark from PDF" (format-specific)
├── Spoke: "Remove watermark on mobile" (device-specific)
├── Spoke: "Remove watermark in PowerPoint" (method-specific)
├── Spoke: "Is it safe to remove watermarks?" (concern-specific)
├── Spoke: "Best watermark remover tools 2026" (comparison)
└── Spoke: "Gamma vs Canva watermark comparison" (competitive)
```

## Phase 3: Content Creation (New Articles)

### Research flow
1. Search MCP with expert model: "[topic] features pricing [year] comparison"
2. Search Reddit/YouTube for authentic user opinions and pain points
3. Cross-reference with existing articles to avoid keyword cannibalization
4. **Competitor content analysis**: search the target keyword, analyze top 3 results for structure, word count, unique angles, and gaps you can fill

### Article templates

**Comparison page (A vs B):**
```markdown
## The short answer
## Free plan comparison (table)
## Pricing comparison (table)
## [Key differentiator] comparison
## [Your product's unique angle] (table)
## Who should pick which (table)
## Our verdict (ratings X/5)
## Frequently asked questions
```

**Guide / tutorial page:**
```markdown
## Why [audience] uses [tool]
## The [problem]
## How to solve it — link to your tool
## Other options
## Tips for [specific use case]
## Frequently asked questions
```

**Review page:**
```markdown
## What is [tool]?
## Key features in [year]
## Pricing breakdown (table)
## What we liked (pros)
## What we did not like (cons)
## How it compares to alternatives (table)
## Our verdict
## Frequently asked questions
```

### Content rules
- Every article should link to your core product/tool at least 2x
- FAQ section uses `**Question?**\nAnswer` format for FAQPage JSON-LD auto-extraction
- Tables for comparisons — Google can display as rich snippets
- relatedSlugs: 3-5 relevant existing articles for cross-linking
- Include current year in title, headings, and content for freshness signals

## Phase 4: Batch Translation

### Translation prompt template
```python
prompt = f"""Translate this blog article to {lang_name}. Rules:
1) Translate title, seoTitle, description (keep in double quotes, keep year).
   Keep date, image, relatedSlugs UNCHANGED.
2) Keep the same markdown structure exactly.
3) Change /{source_lang}/ links to /{target_lang}/.
4) Keep product names in English.
5) No emoji. No HTML. No code fences around output.
6) Keep table structure intact.
7) Output ONLY the translated markdown."""
```

### Execution
- **Parallelism:** 6 workers (ThreadPoolExecutor), timeout 300s.
- **Model selection:** Fast model (grok-4.5, GPT-4o-mini) for bulk; expert model for critical/flagship articles.

### Known translation artifacts (auto-fix)
| Artifact | Pattern | Fix |
|----------|---------|-----|
| Code fence wrapper | ` ```html` or ` ```markdown` at start | Regex strip |
| Duplicate frontmatter | `---\n```html\n---` | Replace with single `---` |
| Model thinking leakage | "Let me translate..." before content | Trim to second `---\ntitle:` |
| HTML output instead of MD | Full `<!DOCTYPE>` returned | Retry with explicit "No HTML" instruction |
| Hindi thinking | Most prone to reasoning leakage | Always verify HI separately |

### Auto-fix script
```python
text = re.sub(r"^```(?:markdown|html)?\s*\n", "", text)
text = re.sub(r"\n```\s*$", "", text)
text = text.replace("---\n```html\n---", "---")
if "Let me" in text[:200] and "---\ntitle:" in text:
    idx = text.index("---\ntitle:")
    text = "---\n" + text[idx+4:]
if not text.startswith("---"):
    text = "---\n" + text
```

## Phase 5: Translation Validation

**5 must-pass checks after every translation batch:**

### 1. Frontmatter parse test
All articles must parse without error. Required fields: title, description, date.

### 2. Structure consistency
H2 count, table row count, and total line count should match the source article (within ±5%).

### 3. Source-language link leakage
Non-source-language articles must not contain `/{source_lang}/blog/` internal links. Exception: external website URLs that happen to contain the source locale path.

### 4. Brand name localization (for applicable languages)
Verify seoTitle uses the localized brand name (e.g., KO must use Hangul, not Latin for the primary brand).

### 5. relatedSlugs integrity
No slug should contain spaces, concatenated values, or YAML formatting errors.

## Phase 6: Internal Linking

### Strategy: Hub-and-spoke
The highest-traffic article (usually the main guide) links out to all supporting content. Supporting articles link back and to each other via relatedSlugs.

### "Related guides" section pattern
Insert before the FAQ section in the main article:
```markdown
## Related guides

- [Article Title](/{lang}/blog/{slug}/) — One-line description.
```

### Rules
- Main/pillar article links to 5-8 supporting articles
- Every new article should be added to relatedSlugs of 3-5 existing high-traffic articles
- Orphan check: if `grep -rl "slug" content/blog/{source_lang}/*.md` returns only the article itself → orphan, needs inbound links
- Broken link check: parse all `/{lang}/blog/{slug}/` links and verify the target file exists

### YAML list editing (critical gotcha)
```python
# NEVER use sed to append to YAML lists — it concatenates on same line.
# ALWAYS use Python with proper newline insertion:
text = re.sub(r'(relatedSlugs:)', r'\1\n  - new-slug', text, count=1)
```

## Phase 7: Technical SEO Audit

**Full checklist — run before major deploys:**

| # | Check | How | Fix |
|---|-------|-----|-----|
| 1 | Frontmatter parse | gray-matter / python-frontmatter all .md | Fix YAML quoting (colons in values need double quotes) |
| 2 | Missing seoTitle | `grep -L seoTitle` per locale | Add per-language optimized title |
| 3 | Missing image | `grep -L '^image:'` | Add field or reuse existing cover |
| 4 | Missing updated date | `grep -L 'updated:'` | Add today's date for freshness |
| 5 | Empty alt text | `grep 'alt=""'` in page components | Use `alt={post.title}` or descriptive text |
| 6 | Description >160 chars | Measure length per article | Shorten to <155 chars (Google truncation) |
| 7 | Broken internal links | Parse all markdown links, verify target file exists | Fix path or remove link |
| 8 | Orphan articles | Count inbound links per slug | Add links from high-traffic pages |
| 9 | relatedSlugs integrity | Parse YAML, check for spaces in slug values | Fix concatenation bugs |
| 10 | Source-lang link leakage | `grep '/{source_lang}/'` in non-source locales | Change to `/{target_lang}/` |
| 11 | Build success | Run full build | Fix any errors before deploy |
| 12 | Sitemap coverage | Check new articles appear in sitemap output | Update sitemap config if needed |

## Phase 7b: Cannibalization Detection

**Script:** `scripts/cannibalization.py`

```bash
python3 scripts/cannibalization.py              # 7-day scan
python3 scripts/cannibalization.py --days 28    # wider window
```

Automatically finds queries where multiple pages compete. Severity levels:
- **HIGH**: 3+ pages on same query → consolidate or differentiate
- **MEDIUM**: 2 pages with close impressions → clarify titles/content angles

**False positive rule for multi-locale sites:** Brand queries (e.g., "yoursite") with 10+
pages competing across locales is NORMAL — Google shows the user's locale version. This is not
real cannibalization. Only flag same-locale pages competing on the same query.
- **LOW**: 2 pages but clear winner → monitor only

**Fix strategies:**
- Same-locale pages fighting: differentiate seoTitle + content angle, or 301 merge
- Cross-locale pages fighting (e.g., /en/ and /es/ on same query): normal, not real cannibalization
- Blog vs tool page: add internal link from blog → tool page to signal which is primary

## Phase 7c: GEO — Generative Engine Optimization

GEO = optimizing content to be **cited by AI search engines** (Google AI Overviews, ChatGPT, Perplexity, Claude). SEO gets you ranked. GEO gets you quoted.

### Content patterns that get AI citations
1. **Direct-answer blocks**: Start each H2 section with a 40-60 word self-contained answer
2. **Structured data tables**: Comparison tables are heavily cited by AI
3. **FAQ with bold question format**: `**Question?**\nDirect answer` — AI engines love extractable Q&A
4. **Numbered lists with clear steps**: "Step 1: Do X. Step 2: Do Y." format
5. **Definitive statements**: "X costs $Y/month" not "X might cost around $Y"
6. **Source attribution**: "According to [Source], ..." adds E-E-A-T + citability

### Anti-patterns for GEO
- Vague hedging ("it depends", "results may vary") — AI prefers decisive answers
- Long paragraphs without structure — AI extracts snippets, not essays
- Missing FAQ section — the easiest win for AI citations

## Phase 7d: E-E-A-T Content Checklist

E-E-A-T = Experience, Expertise, Authoritativeness, Trustworthiness. Google's core quality framework.

**Check before publishing any article:**

| Signal | How to implement | Priority |
|--------|-----------------|----------|
| Author byline | `byline` field or author section in article | High |
| Date + updated date | `date` + `updated` frontmatter fields | High |
| First-hand experience | "We tested...", "In our experience..." | High |
| Specific data/numbers | Exact prices, statistics, benchmarks | High |
| Honest cons/limitations | Never just praise; balanced reviews rank better | Medium |
| External citations | Link to official sources, studies, docs | Medium |
| Internal expertise links | Link to your other detailed guides | Medium |
| Clear methodology | "We compared X by testing Y" | Medium |
| Schema markup | Article + FAQPage + BreadcrumbList JSON-LD | Medium |
| Privacy/trust signals | "No upload", "browser-only", "open source" | Low |

## Phase 8: Deploy & Monitor

1. Run full build — verify page count matches expectation
2. `git add` specific files (never `git add -A` to avoid secrets/binaries)
3. Conventional commit with clear description of what changed and why
4. Push to deploy (CI/CD)
5. Monitor GSC: title re-crawl in 2-3 days, CTR impact in 1-2 weeks

## Metrics to Track

| Metric | Tool | Cadence |
|--------|------|---------|
| Impressions/day | GSC 24h view | Daily during active optimization |
| CTR by language | GSC 7d queries grouped by locale | Weekly |
| Avg position | GSC 7d | Weekly |
| Page count | Build output | Per deploy |
| Broken links | Audit script | Per deploy |
| Keyword coverage gaps | Search MCP research | Monthly |
| seoTitle coverage | `grep -L seoTitle` | Per content batch |

## Anti-patterns (hard-won lessons)

- **Never use `sed` to append YAML list items** — it concatenates on the same line, breaking frontmatter parsing. Always use Python with explicit newline insertion.
- **Never expose untranslated content under foreign hreflang** — Google treats English-fallback pages under a foreign hreflang as duplicate content.
- **Never change high-traffic page titles without A/B baseline** — wait 2+ weeks of GSC data before and after.
- **Never commit without full build verification** — a single frontmatter typo can break the entire static export.
- **Never trust translation completion without validation** — always run the 5-check pipeline. Models drop diacritics, leak thinking, return HTML, or silently produce the wrong language.
- **Never batch-translate without checking the first result** — if the model outputs garbage (HTML, thinking), all parallel translations are wasted. Test one first.
- **gray-matter silently casts `date:` YAML values to JS Date objects** — always normalize back to ISO string. Never `String(date)` directly.
- **Descriptions with colons must be double-quoted in YAML** — `description: "Text: with colon"` not `description: Text: with colon`.
