#!/usr/bin/env python3
"""Merge the multi-page tutorial into one self-contained HTML for publishing.

Reads:
  site/index.html
  site/00-what-youll-build.html ... site/10-managed-agent.html
  site/assets/styles.css
  site/assets/tutorial.js

Writes:
  site/onepager.html  — one HTML document, no external assets.

Transformations:
  - Each chapter's <main> becomes <section class="chapter" data-slug="chNN">.
  - The landing page's <main> becomes the top of the document.
  - Sidebar TOC links: ./NN-name.html  →  #chNN
  - Bottom nav prev/next links:  ./X-name.html  →  #chXX (or top for index).
  - Chapter card hrefs: ./NN-name.html  →  #chNN
  - Inline styles.css inside a single <style> tag.
  - Inline tutorial.js inside a <script> tag, with single-page tweaks:
      · the quiz button handler finds its nearest ancestor [data-slug]
        instead of relying on document.body.dataset.slug
      · IntersectionObserver tracks the visible section and sets .active on
        the matching sidebar link
"""

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"

CHAPTER_FILES = [
    ("ch00", "00-what-youll-build.html"),
    ("ch01", "01-setup.html"),
    ("ch02", "02-first-call.html"),
    ("ch03", "03-tools.html"),
    ("ch04", "04-skills.html"),
    ("ch05", "05-decomposition.html"),
    ("ch06", "06-memory.html"),
    ("ch07", "07-evals.html"),
    ("ch08", "08-rightmodel.html"),
    ("ch09", "09-production.html"),
    ("ch10", "10-managed-agent.html"),
]

FILENAME_TO_SLUG = {fn: slug for slug, fn in CHAPTER_FILES}


def rewrite_href(s: str) -> str:
    """Rewrite href="./NN-name.html" → href="#chNN" inside any HTML fragment."""
    def repl(m):
        target = m.group(1)
        if target == "index.html":
            return 'href="#top"'
        slug = FILENAME_TO_SLUG.get(target)
        if slug is None:
            return m.group(0)
        return f'href="#{slug}"'
    return re.sub(r'href="\./([^"]+\.html)"', repl, s)


def minify_css(css: str) -> str:
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)        # comments
    css = re.sub(r"\s+", " ", css)                  # collapse whitespace
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)   # tighten around punctuation
    css = re.sub(r";}", "}", css)                   # last-rule semicolon
    return css.strip()


def minify_js(js: str) -> str:
    # Strip line comments (// …) and block comments (/* … */), keeping strings intact.
    out = []
    i = 0
    n = len(js)
    while i < n:
        c = js[i]
        nxt = js[i+1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = js.find("\n", i)
            if j == -1:
                break
            i = j
            continue
        if c == "/" and nxt == "*":
            j = js.find("*/", i + 2)
            if j == -1:
                break
            i = j + 2
            continue
        if c in ('"', "'", "`"):
            quote = c
            out.append(c)
            i += 1
            while i < n:
                if js[i] == "\\":
                    out.append(js[i:i+2])
                    i += 2
                    continue
                out.append(js[i])
                if js[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    js = "".join(out)
    # Collapse runs of whitespace but keep newlines as separators (safe for JS without ASI hazards we control).
    js = re.sub(r"[ \t]+", " ", js)
    js = re.sub(r"\n+", "\n", js)
    js = re.sub(r"\s*([{};,])\s*", r"\1", js)
    return js.strip()


def extract_main(html: str) -> str:
    """Return the inner HTML of the <main>…</main> block."""
    m = re.search(r"<main>([\s\S]*?)</main>", html)
    if not m:
        raise SystemExit("no <main> in page")
    return m.group(1)


def extract_sidebar(html: str) -> str:
    """Return the <aside class=sidebar>…</aside> block."""
    m = re.search(r'<aside class="sidebar">[\s\S]*?</aside>', html)
    if not m:
        raise SystemExit("no <aside class=sidebar> in page")
    return m.group(0)


def build_section(slug: str, fname: str) -> str:
    path = SITE / fname
    html = path.read_text()
    main = extract_main(html)
    main = rewrite_href(main)
    # The bottom nav uses .nav-bottom; keep it but anchorize its hrefs (already
    # done by rewrite_href above).
    return f'<section class="chapter" id="{slug}" data-slug="{slug}">\n{main}\n</section>\n'


def build():
    index_html = (SITE / "index.html").read_text()
    sidebar = rewrite_href(extract_sidebar(index_html))
    index_main = rewrite_href(extract_main(index_html))

    sections = "\n".join(build_section(slug, fn) for slug, fn in CHAPTER_FILES)

    # Generate side-by-side: an inlined onepager (for opening locally / file://)
    # and the separate CSS + JS files (for uploading as HTMLPub assets).
    raw_styles = (SITE / "assets" / "styles.css").read_text()
    raw_js = (SITE / "assets" / "tutorial.js").read_text()
    extra_styles = """
/* one-pager additions */
section.chapter { scroll-margin-top: 24px; padding-top: 8px; }
section.chapter + section.chapter { margin-top: 40px; padding-top: 40px; border-top: 1px solid var(--rule); }
.sidebar .toc li a { scroll-margin-top: 12px; }
"""
    styles = minify_css(raw_styles + extra_styles)
    base_js = minify_js(raw_js)

    # Single-page JS tweaks: replace the body-slug lookup in the quiz with a
    # nearest-ancestor lookup, and add an IntersectionObserver for active link.
    extra_js = """
// --- single-page mode: progress + active link via section data-slugs --------
(function () {
  function nearestSlug(el) {
    const owner = el.closest('[data-slug]');
    return owner ? owner.dataset.slug : null;
  }
  // Override the existing quiz handlers to scope to the section's data-slug.
  document.querySelectorAll('.quiz').forEach((quiz) => {
    const buttons = quiz.querySelectorAll('button.opt');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!btn.classList.contains('right')) return;
        const slug = nearestSlug(quiz);
        if (!slug) return;
        try {
          const state = JSON.parse(localStorage.getItem('cwc-tutorial-v1') || '{}');
          state.completed = state.completed || {};
          state.completed[slug] = true;
          localStorage.setItem('cwc-tutorial-v1', JSON.stringify(state));
        } catch (_) {}
        document.querySelectorAll('.sidebar .toc li').forEach((li) => {
          if (li.dataset.slug && JSON.parse(localStorage.getItem('cwc-tutorial-v1') || '{}').completed?.[li.dataset.slug]) {
            li.classList.add('done');
          }
        });
        const total = document.querySelectorAll('.chapter-card').length;
        const done = Object.keys(JSON.parse(localStorage.getItem('cwc-tutorial-v1') || '{}').completed || {}).length;
        const fill = document.querySelector('.progress-bar .fill');
        const label = document.querySelector('.progress-label');
        if (fill) fill.style.width = total ? (Math.round((done / total) * 100) + '%') : '0%';
        if (label) label.textContent = `${done} / ${total} chapters complete · ${total ? Math.round((done / total) * 100) : 0}%`;
      }, true);
    });
  });
  // Active sidebar link follows scroll.
  const sections = document.querySelectorAll('section.chapter');
  if (sections.length && 'IntersectionObserver' in window) {
    const links = new Map();
    document.querySelectorAll('.sidebar .toc li a').forEach((a) => {
      if (a.dataset.slug) links.set(a.dataset.slug, a);
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const slug = e.target.dataset.slug;
        document.querySelectorAll('.sidebar .toc li a').forEach((a) => a.classList.remove('active'));
        const link = links.get(slug);
        if (link) link.classList.add('active');
      });
    }, { rootMargin: '-30% 0px -65% 0px', threshold: 0 });
    sections.forEach((s) => io.observe(s));
  }
})();
"""

    chapter_count = len(CHAPTER_FILES)
    title = "From a Prompt to a Production Agent · CWC 2026 Tutorial"

    full_js = (base_js + "\n" + extra_js).strip()

    # Write the asset files for upload.
    build_dir = SITE / "build"
    build_dir.mkdir(exist_ok=True)
    (build_dir / "tutorial-styles.css").write_text(styles)
    (build_dir / "tutorial-onepager.js").write_text(full_js)
    print(f"  → site/build/tutorial-styles.css     ({len(styles.encode('utf8')):,} bytes)")
    print(f"  → site/build/tutorial-onepager.js    ({len(full_js.encode('utf8')):,} bytes)")

    # Two output HTMLs: one inline (works locally), one external-asset (for HTMLPub).
    inline_html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{styles}</style>
</head>
<body data-slug="index" id="top">
<div class="layout">
{sidebar}
<main>
{index_main}
<hr style="margin: 80px 0 64px;">
{sections}
</main>
</div>
<script>{full_js}</script>
</body>
</html>
"""

    external_html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="__CSS_URL__">
</head>
<body data-slug="index" id="top">
<div class="layout">
{sidebar}
<main>
{index_main}
<hr style="margin: 80px 0 64px;">
{sections}
</main>
</div>
<script src="__JS_URL__" defer></script>
</body>
</html>
"""

    html = inline_html  # for the existing "site/onepager.html" target
    (build_dir / "onepager-external.html").write_text(external_html)
    print(f"  → site/build/onepager-external.html  ({len(external_html.encode('utf8')):,} bytes, awaits URL substitution)")

    # Bootstrap path: a TINY page stub + a JS asset that synchronously injects
    # the full body content. Asset uploads aren't token-limited, page HTML is.
    body_inner = f"""
<div class="layout">
{sidebar}
<main>
{index_main}
<hr style="margin: 80px 0 64px;">
{sections}
</main>
</div>
"""
    js_string_literal = (
        body_inner
        .replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("${", "\\${")
    )
    content_js = (
        "// Auto-generated by build_onepager.py — injects the tutorial body content\n"
        "// synchronously, then lets tutorial.js init against it.\n"
        "(function () {\n"
        "  const root = document.getElementById('content');\n"
        "  if (!root) return;\n"
        "  root.innerHTML = `" + js_string_literal + "`;\n"
        "})();\n"
    )
    (build_dir / "tutorial-content.js").write_text(content_js)
    print(f"  → site/build/tutorial-content.js     ({len(content_js.encode('utf8')):,} bytes)")

    stub_html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{title}</title>'
        '<link rel="stylesheet" href="__CSS_URL__">'
        '</head>'
        '<body data-slug="index" id="top"><div id="content"></div>'
        '<script src="__CONTENT_URL__"></script>'
        '<script src="__JS_URL__"></script>'
        '</body></html>'
    )
    (build_dir / "stub-page.html").write_text(stub_html)
    print(f"  → site/build/stub-page.html          ({len(stub_html.encode('utf8')):,} bytes)")

    html = minify_html(html)
    out = SITE / "onepager.html"
    out.write_text(html)
    print(f"✓ wrote {out}  ({len(html.encode('utf8')):,} bytes, {chapter_count + 1} chapters merged)")


def minify_html(html: str) -> str:
    """Collapse whitespace OUTSIDE of <pre>, <code>, <script>, <style>, <textarea>.
    Removes HTML comments. Preserves all meaningful whitespace inside text-sensitive tags.
    """
    PRESERVE = ("pre", "code", "script", "style", "textarea")
    # Step 1: split into tokens that alternate between "preserve" blocks and "compressible" content.
    parts = re.split(
        r"(<(?:" + "|".join(PRESERVE) + r")\b[^>]*>[\s\S]*?</(?:" + "|".join(PRESERVE) + r")>)",
        html,
        flags=re.IGNORECASE,
    )
    out = []
    for i, p in enumerate(parts):
        if i % 2 == 1:
            # Preserve block — leave alone.
            out.append(p)
            continue
        # Compressible block.
        p = re.sub(r"<!--[\s\S]*?-->", "", p)
        p = re.sub(r"\s+", " ", p)
        p = re.sub(r">\s+<", "><", p)
        out.append(p)
    return "".join(out).strip()


if __name__ == "__main__":
    build()
