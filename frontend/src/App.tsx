import { Suspense, lazy, onCleanup, type JSX } from "solid-js";
import { Navigate, Route, Router, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { api } from "./api/client";
import { setMe } from "./lib/auth";
import { GuestOnly, RequireAuth } from "./components/RouteGuards";
import { ToastRegion } from "./components/Toast";

const SignIn = lazy(() => import("./pages/auth/SignIn"));
const SignUp = lazy(() => import("./pages/auth/SignUp"));
const DemoExpired = lazy(() => import("./pages/auth/DemoExpired"));
const SignedOut = lazy(() => import("./pages/auth/SignedOut"));
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const ProductList = lazy(() => import("./pages/products/ProductList"));
const ProductForm = lazy(() => import("./pages/products/ProductForm"));
const ProductDetails = lazy(() => import("./pages/products/ProductDetails"));
const Categories = lazy(() => import("./pages/categories/Categories"));
const ReceiptList = lazy(() => import("./pages/documents/ReceiptList"));
const ReceiptPage = lazy(() => import("./pages/documents/ReceiptPage"));
const WriteOffList = lazy(() => import("./pages/documents/WriteOffList"));
const WriteOffPage = lazy(() => import("./pages/documents/WriteOffPage"));
const ReversalPage = lazy(() => import("./pages/documents/ReversalPage"));
const StockCountList = lazy(() => import("./pages/stock-counts/StockCountList"));
const StockCountPage = lazy(() => import("./pages/stock-counts/StockCountPage"));
const History = lazy(() => import("./pages/history/History"));
const Reports = lazy(() => import("./pages/reports/Reports"));
const NotFound = lazy(() => import("./pages/NotFound"));

/** Root layout: central 401 handling + global toast region. */
function Root(props: RouteSectionProps): JSX.Element {
  const navigate = useNavigate();
  api.setAuthErrorHandler((code) => {
    setMe(null);
    navigate(code === "demo_expired" ? "/demo-expired" : "/sign-in", { replace: true });
  });
  onCleanup(() => api.setAuthErrorHandler(undefined));
  return (
    <>
      <Suspense>{props.children}</Suspense>
      <ToastRegion />
    </>
  );
}

const Authed = (props: RouteSectionProps) => <RequireAuth>{props.children}</RequireAuth>;
const Guest = (props: RouteSectionProps) => <GuestOnly>{props.children}</GuestOnly>;
const GuestOrDemo = (props: RouteSectionProps) => <GuestOnly allowDemo>{props.children}</GuestOnly>;

/** Route table (paths are final). Used by <App/> and by tests with a memory router. */
export function AppRoutes(): JSX.Element {
  return (
    <>
      <Route path="/" component={() => <Navigate href="/dashboard" />} />
      <Route component={Guest}>
        <Route path="/sign-in" component={SignIn} />
        <Route path="/demo-expired" component={DemoExpired} />
        <Route path="/signed-out" component={SignedOut} />
      </Route>
      <Route component={GuestOrDemo}>
        <Route path="/sign-up" component={SignUp} />
      </Route>
      <Route component={Authed}>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/products" component={ProductList} />
        <Route path="/products/new" component={ProductForm} />
        <Route path="/products/:id/edit" component={ProductForm} />
        <Route path="/products/:id" component={ProductDetails} />
        <Route path="/categories" component={Categories} />
        <Route path="/receipts" component={ReceiptList} />
        <Route path={["/receipts/new", "/receipts/:id"]} component={ReceiptPage} />
        <Route path="/write-offs" component={WriteOffList} />
        <Route path={["/write-offs/new", "/write-offs/:id"]} component={WriteOffPage} />
        <Route path="/reversals/:id" component={ReversalPage} />
        <Route path="/stock-counts" component={StockCountList} />
        <Route path={["/stock-counts/new", "/stock-counts/:id"]} component={StockCountPage} />
        <Route path="/history" component={History} />
        <Route path="/reports" component={() => <Navigate href="/reports/stock-on-date" />} />
        <Route path="/reports/:report" component={Reports} />
        <Route path="*404" component={NotFound} />
      </Route>
    </>
  );
}

export function App(): JSX.Element {
  return (
    <Router root={Root}>
      <AppRoutes />
    </Router>
  );
}

export { Root };
