import sun from "heroicons/24/outline/sun.svg?raw";
import moon from "heroicons/24/outline/moon.svg?raw";
import search from "heroicons/24/outline/magnifying-glass.svg?raw";
import download from "heroicons/24/outline/arrow-down-tray.svg?raw";
import clipboard from "heroicons/24/outline/clipboard-document.svg?raw";
import check from "heroicons/24/outline/check.svg?raw";
import close from "heroicons/24/outline/x-mark.svg?raw";
import trash from "heroicons/24/outline/trash.svg?raw";
import globe from "heroicons/24/outline/globe-alt.svg?raw";
import user from "heroicons/24/outline/user-circle.svg?raw";
import signIn from "heroicons/24/outline/arrow-left-start-on-rectangle.svg?raw";
import signOut from "heroicons/24/outline/arrow-right-start-on-rectangle.svg?raw";
import stack from "heroicons/24/outline/circle-stack.svg?raw";
import clock from "heroicons/24/outline/clock.svg?raw";
import map from "heroicons/24/outline/map.svg?raw";
import doc from "heroicons/24/outline/document-text.svg?raw";
import chevron from "heroicons/24/outline/chevron-right.svg?raw";
import terminal from "heroicons/24/outline/command-line.svg?raw";
import archive from "heroicons/24/outline/archive-box.svg?raw";
import pin from "heroicons/24/outline/map-pin.svg?raw";
import shield from "heroicons/24/outline/shield-check.svg?raw";
import external from "heroicons/24/outline/arrow-top-right-on-square.svg?raw";
import bolt from "heroicons/24/outline/bolt.svg?raw";
import undo from "heroicons/24/outline/arrow-uturn-left.svg?raw";
import chart from "heroicons/24/outline/chart-bar.svg?raw";
import grid from "heroicons/24/outline/squares-2x2.svg?raw";

const ICONS = {
  sun, moon, search, download, clipboard, check, close, trash, globe, user, signIn, signOut, stack,
  clock, map, doc, chevron, terminal, archive, pin, shield, external, bolt, undo, chart, grid
};

/** An icon's markup, for splicing into a template with raw(). */
export const icon = name => ICONS[name] ?? "";

/** Categories and dataset kinds each have a glyph, used on cards and headers. */
export const CATEGORY_ICON = {hydrography: "map", retrospective: "chart", forecasts: "bolt"};
