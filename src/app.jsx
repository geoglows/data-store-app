import {ErrorBoundary, LocationProvider, Route, Router, lazy} from "preact-iso";
import {Suspense} from "preact/compat";
import {BASE_PATH} from "./routes.js";
import {TopBar} from "./components/TopBar.jsx";
import {Crumbs} from "./components/Crumbs.jsx";
import {Versions} from "./pages/Versions.jsx";
import {Listing} from "./pages/Listing.jsx";
import {Dataset} from "./pages/Dataset.jsx";
import {PackagePage, PackagesIndex} from "./pages/Packages.jsx";
import {NotFound} from "./pages/NotFound.jsx";

// The specification documents and the markdown renderer are a quarter of a megabyte that only the
// specification section needs, so that section is a chunk of its own.
const Spec = lazy(() => import("./pages/Spec.jsx").then(m => m.Spec));

const p = route => `${BASE_PATH}${route}`;

/**
 * Every page has its own address. The router matches real paths — no hash — and the build writes an
 * index.html at each of them, so opening one directly loads that page rather than the home page
 * redirecting to it.
 */
export function App() {
  return (
    <LocationProvider scope={BASE_PATH || "/"}>
      <TopBar/>
      <Crumbs/>
      <main id="view">
        <ErrorBoundary>
          <Suspense fallback={<div class="page empty">Loading…</div>}>
            <Router>
              <Route path={p("/")} component={Versions}/>
              <Route path={p("/datasets")} component={Versions}/>
              <Route path={p("/packages")} component={PackagesIndex}/>
              <Route path={p("/packages/:id")} component={PackagePage}/>
              <Route path={p("/spec")} component={Spec}/>
              <Route path={p("/spec/:doc")} component={Spec}/>
              <Route path={p("/datasets/:version")} component={Listing}/>
              <Route path={p("/datasets/:version/:product")} component={Dataset}/>
              <Route path={p("/datasets/:version/:product/:tab")} component={Dataset}/>
              <Route default component={NotFound}/>
            </Router>
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer id="footer">
        <span>GEOGLOWS River Forecast System</span>
        <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>
        <a href={import.meta.env.VITE_PORTAL_URL} target="_blank" rel="noopener">apps.geoglows.org</a>
      </footer>
    </LocationProvider>
  );
}
