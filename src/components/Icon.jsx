import {icon} from "../ui/icons.js";

/** Heroicons ship as markup, so they are spliced in rather than rebuilt as components. */
export function Icon({name, class: cls}) {
  return <span class={`ico ${cls ?? ""}`} dangerouslySetInnerHTML={{__html: icon(name)}}/>;
}
