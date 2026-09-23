import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/download.css";
import {render} from "preact";
import "./data/sources.js";
import {initTheme} from "./ui/theme.js";
import {App} from "./app.jsx";

initTheme();
render(<App/>, document.getElementById("app"));
