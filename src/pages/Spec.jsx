import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {marked} from "marked";
import {SPEC_DOCS, specDoc} from "../data/specDocs.js";
import {routes} from "../routes.js";
import {useCrumbs} from "../ui/crumbs.js";
import {fmtDate, copyText} from "../dom.js";
import {Icon} from "../components/Icon.jsx";
import {icon} from "../ui/icons.js";

// The specification documents, verbatim. scripts/sync-spec.sh puts them under ./docs/spec — a working
// copy that is not part of this repository — and they are read as text, so what this page shows is
// byte for byte what the master repository holds. Globbed rather than imported one by one: a build
// made before the documents were synced is then a page that says so, not a build that fails.
const FILES = import.meta.glob("../../docs/spec/**/*.md", {query: "?raw", import: "default", eager: true});
const SOURCES = import.meta.glob("../../docs/spec/SOURCE.json", {import: "default", eager: true});

const textFor = doc => FILES[Object.keys(FILES).find(k => k.endsWith(`/docs/spec/${doc.vendored}`)) ?? ""] ?? null;
const source = Object.values(SOURCES)[0] ?? {repository: "https://github.com/river-forecast-system/rfs-specification-documents", commit: "", commitSubject: "", commitDate: ""};

/** Markdown links between the documents become links between these pages. */
const BY_FILE = Object.fromEntries(SPEC_DOCS.flatMap(d => [[d.file, d.id], [d.file.split("/").pop(), d.id]]));

const slug = (text, used) => {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
};

/**
 * The specification explorer: the documents on the left, one rendered document beside them with its
 * own contents, and the commit the text was taken from underneath.
 *
 * The document is markdown the app does not own, so it is rendered to HTML and then walked once —
 * headings get ids, cross-document links get rewritten, code blocks get a copy button. That walk is
 * the one place this app touches the DOM directly, because the nodes it fixes up were not built
 * from components.
 */
export function Spec({doc: docId}) {
  const doc = specDoc(docId);
  const text = textFor(doc);
  const body = useRef(null);
  const [toc, setToc] = useState([]);

  useCrumbs([
    {label: "Data Store", href: routes.home()},
    {label: "Specification", href: routes.spec()},
    {label: doc.title, href: routes.spec(doc.id)}
  ]);

  const rendered = useMemo(() => (text ? marked.parse(text, {gfm: true, breaks: false}) : ""), [doc.id, text]);

  useEffect(() => {
    const el = body.current;
    if (!el || !text) return;
    const used = new Set();
    const items = [];
    for (const h of el.querySelectorAll("h1, h2, h3")) {
      h.id = slug(h.textContent, used);
      if (h.tagName !== "H1") items.push({id: h.id, level: h.tagName.toLowerCase(), text: h.textContent});
    }
    setToc(items);

    for (const a of el.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      const target = BY_FILE[href] ?? BY_FILE[href.replace(/^\.\//, "")];
      if (target) a.setAttribute("href", routes.spec(target));
      else if (/^https?:/.test(href)) a.setAttribute("target", "_blank");
    }

    for (const pre of el.querySelectorAll("pre")) {
      if (pre.parentElement?.classList.contains("code")) continue;
      const wrap = document.createElement("div");
      wrap.className = "code";
      pre.replaceWith(wrap);
      wrap.append(pre);
      const btn = document.createElement("button");
      btn.className = "btn icon copy";
      btn.type = "button";
      btn.setAttribute("aria-label", "Copy");
      btn.innerHTML = `${icon("clipboard")}${icon("check")}`;
      btn.addEventListener("click", () => copyText(pre.textContent, btn));
      wrap.append(btn);
    }
  }, [rendered]);

  const jump = (e, id) => {
    e.preventDefault();
    body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({behavior: "smooth", block: "start"});
  };

  return (
    <section class="page spec-page">
      <aside class="spec-nav">
        <h4>Documents</h4>
        <ul class="links">
          {SPEC_DOCS.map(d => (
            <li key={d.id}><a class={d.id === doc.id ? "on" : ""} href={routes.spec(d.id)}>{d.title}</a></li>
          ))}
        </ul>
        <h4>Contents</h4>
        <ul class="links toc" id="toc">
          {toc.map(t => (
            <li class={t.level} key={t.id}><a href={`#${t.id}`} onClick={e => jump(e, t.id)}>{t.text}</a></li>
          ))}
        </ul>
        <div class="side-card source">
          <h4>Source</h4>
          <p class="small">Verbatim from <code>{doc.file}</code></p>
          {source.commit
            ? <>
              <p class="small mono break">{source.commit.slice(0, 10)} · {fmtDate(source.commitDate.slice(0, 10))}</p>
              <p class="small">{source.commitSubject}</p>
            </>
            : null}
          <a class="small" href={source.repository} target="_blank" rel="noopener">Master copy <Icon name="external"/></a>
        </div>
      </aside>
      {text
        ? <article class="doc-body" id="doc" ref={body} dangerouslySetInnerHTML={{__html: rendered}}/>
        : (
          <article class="doc-body empty">
            <h1>Not synced</h1>
            <p>This build carries no copy of <code>{doc.file}</code>. Run <code>./scripts/sync-spec.sh</code> and build again.</p>
          </article>
        )}
    </section>
  );
}
