import {useLocation} from "preact-iso";
import {authSlot} from "../account/auth.js";
import {toggleTheme, useTheme} from "../ui/theme.js";
import {BASE_PATH, routes} from "../routes.js";
import {Icon} from "./Icon.jsx";

const SECTIONS = [
  {id: "datasets", label: "Datasets", href: routes.home()},
  {id: "packages", label: "Packages", href: routes.packages()},
  {id: "spec", label: "Specification", href: routes.spec()}
];

/** Which section the current path belongs to: everything that is not packages or spec is a dataset. */
const sectionOf = (url) => {
  const first = url.replace(BASE_PATH, "").split("?")[0].split("/").filter(Boolean)[0];
  return first === "packages" || first === "spec" ? first : "datasets";
};

export function TopBar() {
  const {url} = useLocation();
  const theme = useTheme();
  const here = sectionOf(url);
  const env = import.meta.env;
  return (
    <header id="topbar">
      <a class="brand" href={env.VITE_LOGO_HREF} aria-label="GEOGLOWS apps">
        <img src={env.VITE_LOGO_SRC} alt={env.VITE_LOGO_ALT} width={env.VITE_LOGO_WIDTH} height={env.VITE_LOGO_HEIGHT}/>
      </a>
      <a class="app-title" href={routes.home()}>{env.VITE_APP_TITLE}</a>
      <nav class="row" id="topnav">
        {SECTIONS.map(s => (
          <a key={s.id} class={`navlink ${here === s.id ? "on" : ""}`} data-section={s.id} href={s.href}>{s.label}</a>
        ))}
        <button id="btn-theme" class="btn icon" aria-label="Toggle light and dark theme" onClick={toggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"}/>
        </button>
        <div class="auth-host" ref={el => el && authSlot.parentNode !== el && el.appendChild(authSlot)}/>
      </nav>
    </header>
  );
}
