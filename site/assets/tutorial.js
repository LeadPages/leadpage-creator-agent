// Tutorial runtime: progress tracking, copy buttons, quiz logic, code highlighting.
(function () {
  const STORAGE_KEY = "cwc-tutorial-v1";

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function markChapterDone(slug) {
    const state = loadState();
    state.completed = state.completed || {};
    state.completed[slug] = true;
    saveState(state);
  }

  function renderTOCProgress() {
    const state = loadState();
    const completed = state.completed || {};
    document.querySelectorAll(".sidebar .toc li").forEach((li) => {
      const slug = li.dataset.slug;
      if (slug && completed[slug]) li.classList.add("done");
    });
    document.querySelectorAll(".chapter-card").forEach((card) => {
      const slug = card.dataset.slug;
      if (slug && completed[slug]) card.classList.add("done");
    });
    const progressFill = document.querySelector(".progress-bar .fill");
    const progressLabel = document.querySelector(".progress-label");
    if (progressFill && progressLabel) {
      const total = document.querySelectorAll(".chapter-card").length;
      const done = Object.keys(completed).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      progressFill.style.width = pct + "%";
      progressLabel.textContent = `${done} / ${total} chapters complete · ${pct}%`;
    }
  }

  function markActiveTOC() {
    const slug = document.body.dataset.slug;
    if (!slug) return;
    document.querySelectorAll(".sidebar .toc li a").forEach((a) => {
      if (a.dataset.slug === slug) a.classList.add("active");
    });
  }

  function attachCopyButtons() {
    document.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".copy")) return;
      const btn = document.createElement("button");
      btn.className = "copy";
      btn.textContent = "copy";
      btn.addEventListener("click", async () => {
        const code = pre.querySelector("code");
        const text = code ? code.innerText : pre.innerText;
        try {
          await navigator.clipboard.writeText(text);
          btn.classList.add("copied");
          btn.textContent = "copied!";
          setTimeout(() => {
            btn.classList.remove("copied");
            btn.textContent = "copy";
          }, 1400);
        } catch (_) {
          btn.textContent = "failed";
        }
      });
      pre.appendChild(btn);
    });
  }

  function attachQuiz() {
    document.querySelectorAll(".quiz").forEach((quiz) => {
      const buttons = quiz.querySelectorAll("button.opt");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (quiz.classList.contains("answered")) return;
          const right = btn.dataset.right === "true";
          btn.classList.add(right ? "right" : "wrong");
          if (!right) {
            buttons.forEach((b) => {
              if (b.dataset.right === "true") b.classList.add("right");
            });
          }
          quiz.classList.add("answered");
          if (right) {
            const slug = document.body.dataset.slug;
            if (slug) markChapterDone(slug);
            renderTOCProgress();
          }
        });
      });
    });
  }

  // Light TypeScript-ish syntax highlighter. Plain monospace if not flagged.
  function highlightCode() {
    const KW = new Set([
      "import", "from", "as", "const", "let", "var", "function", "async",
      "await", "return", "if", "else", "for", "while", "do", "of", "in",
      "new", "class", "extends", "interface", "type", "export", "default",
      "try", "catch", "finally", "throw", "switch", "case", "break", "continue",
      "true", "false", "null", "undefined", "this", "typeof", "instanceof",
      "void"
    ]);
    document.querySelectorAll("pre code.lang-ts, pre code.lang-js, pre code.lang-tsx").forEach((code) => {
      const text = code.textContent;
      const tokens = [];
      const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
      let m, last = 0;
      while ((m = re.exec(text))) {
        if (m.index > last) tokens.push({ t: "", v: text.slice(last, m.index) });
        if (m[1]) tokens.push({ t: "com", v: m[1] });
        else if (m[2]) tokens.push({ t: "str", v: m[2] });
        else if (m[3]) tokens.push({ t: "num", v: m[3] });
        else if (m[4]) tokens.push({ t: KW.has(m[4]) ? "kw" : "", v: m[4] });
        last = m.index + m[0].length;
      }
      if (last < text.length) tokens.push({ t: "", v: text.slice(last) });
      code.innerHTML = tokens.map(({ t, v }) => {
        const esc = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return t ? `<span class="tok-${t}">${esc}</span>` : esc;
      }).join("");
    });
  }

  // Heredoc-style filename label on pre blocks (data-file="path/x.ts" attr).
  // We wrap each pre in a .pre-wrap container so the filename can sit on top
  // of the pre's border — putting it inside the <pre> gets clipped by the
  // overflow-x:auto we need for horizontal code scroll.
  function attachFilenames() {
    document.querySelectorAll("pre[data-file]").forEach((pre) => {
      const parent = pre.parentElement;
      if (parent && parent.classList.contains("pre-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const fn = document.createElement("span");
      fn.className = "filename";
      fn.textContent = pre.dataset.file;
      wrap.appendChild(fn);
    });
  }

  function autoMarkLandingProgress() {
    // Visiting any chapter page marks it "viewed" implicitly only when a quiz
    // is answered correctly. The landing page itself is not a chapter.
  }

  function init() {
    renderTOCProgress();
    markActiveTOC();
    attachCopyButtons();
    attachFilenames();
    highlightCode();
    attachQuiz();
    autoMarkLandingProgress();

    // Reset button on landing page
    const reset = document.getElementById("reset-progress");
    if (reset) {
      reset.addEventListener("click", () => {
        if (confirm("Clear your tutorial progress?")) {
          localStorage.removeItem(STORAGE_KEY);
          renderTOCProgress();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
