import {routes} from "../routes.js";
import {useCrumbs} from "../ui/crumbs.js";

export function NotFound() {
  useCrumbs([{label: "Data Store", href: routes.home()}, {label: "Not found", href: ""}]);
  return (
    <section class="page narrow empty">
      <h1>Not found</h1>
      <p>There is no page at this address.</p>
      <a class="btn" href={routes.home()}>Back to the data store</a>
    </section>
  );
}
