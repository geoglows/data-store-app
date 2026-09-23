import {useRef, useState} from "preact/hooks";
import {copyText} from "../dom.js";
import {Icon} from "./Icon.jsx";

/** A block of copyable code — the shape every command, snippet and path on the site is shown in. */
export function CodeBlock({code}) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  const copy = async () => {
    await copyText(code);
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1200);
  };
  return (
    <div class="code">
      <pre><code>{code}</code></pre>
      <button type="button" class={`btn icon copy ${done ? "done" : ""}`} aria-label="Copy" onClick={copy}>
        <Icon name="clipboard"/><Icon name="check"/>
      </button>
    </div>
  );
}
