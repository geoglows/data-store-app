import {crumbStore} from "../ui/crumbs.js";
import {useStore} from "../ui/store.js";
import {Icon} from "./Icon.jsx";

export function Crumbs() {
  const items = useStore(crumbStore);
  return (
    <nav id="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((c, i) => (i === items.length - 1
          ? <li key={c.href} aria-current="page">{c.label}</li>
          : <li key={c.href}><a href={c.href}>{c.label}</a><Icon name="chevron"/></li>))}
      </ol>
    </nav>
  );
}
