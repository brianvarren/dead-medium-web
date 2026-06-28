/*
    code-window.js
    Custom element that fetches and displays source files from a public GitHub repo.

    Usage:
      <code-window
        data-repo="owner/repo"
        data-branch="main"
        data-path="src/firmware"
        data-files="main.c,config.h">   <!-- optional: curated list; omit to list whole directory -->
      </code-window>

    Requires: highlight.js loaded globally (window.hljs) for syntax highlighting.
    Caches API responses and file content in sessionStorage.
*/

const CACHE = "dm_cw_";

function cget(k) {
    try { return sessionStorage.getItem(CACHE + k); } catch { return null; }
}
function cset(k, v) {
    try { sessionStorage.setItem(CACHE + k, v); } catch {}
}

function ext_lang(name) {
    const ext = name.split(".").pop().toLowerCase();
    return (
        { c: "c", h: "c", cpp: "cpp", hpp: "cpp", ino: "cpp",
          py: "python", js: "javascript", ts: "typescript",
          json: "json", md: "markdown", sh: "bash",
          yaml: "yaml", yml: "yaml", cmake: "cmake" }[ext] ?? "plaintext"
    );
}

async function gh_list(repo, path, branch) {
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
    const hit = cget(url);
    if (hit) return JSON.parse(hit);
    const res = await fetch(url, { headers: { Accept: "application/vnd.github.v3+json" } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    const data = await res.json();
    cset(url, JSON.stringify(data));
    return data;
}

async function raw_fetch(url) {
    const hit = cget(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    const text = await res.text();
    cset(url, text);
    return text;
}

class CodeWindow extends HTMLElement {
    connectedCallback() {
        this._repo   = this.dataset.repo;
        this._branch = this.dataset.branch || "main";
        this._path   = this.dataset.path   || "";
        this._explicit = this.dataset.files
            ?.split(",").map(s => s.trim()).filter(Boolean);
        this._open   = false;
        this._loaded = false;
        this._build();
    }

    _build() {
        const slug = this._path ? `${this._repo}/${this._path}` : this._repo;
        this.innerHTML = `
<div class="cw-header" role="button" tabindex="0" aria-expanded="false">
  <span class="cw-arrow" aria-hidden="true">▶</span>
  <span class="cw-label">SOURCE</span>
  <span class="cw-repo">${slug}</span>
</div>
<div class="cw-body" hidden>
  <div class="cw-tabs" role="tablist"></div>
  <div class="cw-pane">
    <div class="cw-msg"></div>
    <div class="cw-code" hidden><pre><code></code></pre></div>
  </div>
</div>`;

        const hdr = this.querySelector(".cw-header");
        hdr.addEventListener("click",   () => this._toggle());
        hdr.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._toggle(); }
        });
    }

    async _toggle() {
        this._open = !this._open;
        const body = this.querySelector(".cw-body");
        const arrow = this.querySelector(".cw-arrow");
        const hdr   = this.querySelector(".cw-header");
        body.hidden = !this._open;
        arrow.textContent = this._open ? "▼" : "▶";
        hdr.setAttribute("aria-expanded", String(this._open));
        if (this._open && !this._loaded) {
            this._loaded = true;
            await this._load();
        }
    }

    _msg(text) {
        const el = this.querySelector(".cw-msg");
        el.textContent = text;
        el.hidden = !text;
    }

    async _load() {
        this._msg("fetching…");
        try {
            let files;
            if (this._explicit) {
                const base = `https://raw.githubusercontent.com/${this._repo}/${this._branch}/${this._path ? this._path + "/" : ""}`;
                files = this._explicit.map(name => ({ name, raw: base + name }));
            } else {
                const entries = await gh_list(this._repo, this._path, this._branch);
                files = entries
                    .filter(e => e.type === "file")
                    .map(e => ({ name: e.name, raw: e.download_url }));
            }

            const tabs = this.querySelector(".cw-tabs");
            tabs.innerHTML = files.map((f, i) =>
                `<button class="cw-tab" role="tab" data-name="${f.name}" data-raw="${f.raw}" aria-selected="${i === 0}">${f.name}</button>`
            ).join("");

            tabs.querySelectorAll(".cw-tab").forEach(btn =>
                btn.addEventListener("click", () => this._show(btn))
            );

            this._msg("");
            const first = tabs.querySelector(".cw-tab");
            if (first) this._show(first);
        } catch (e) {
            this._msg(`error: ${e.message}`);
        }
    }

    async _show(btn) {
        this.querySelectorAll(".cw-tab").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        const code = this.querySelector("code");
        const pane = this.querySelector(".cw-code");
        this._msg(`loading ${btn.dataset.name}…`);
        pane.hidden = true;

        try {
            const text = await raw_fetch(btn.dataset.raw);
            const lang = ext_lang(btn.dataset.name);
            code.className = `language-${lang} hljs`;
            if (window.hljs) {
                code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
            } else {
                code.textContent = text;
            }
            this._msg("");
            pane.hidden = false;
        } catch (e) {
            this._msg(`error loading ${btn.dataset.name}: ${e.message}`);
        }
    }
}

customElements.define("code-window", CodeWindow);
