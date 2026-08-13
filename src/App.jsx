import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { CatalogProvider } from './context/CatalogContext';
import { OrderProvider } from './context/OrderContext';
import { CartProvider } from './context/CartContext';
import Header from './components/Header';
import ServiceBar from './components/ServiceBar';
import PromoBanner from './components/PromoBanner';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import OrderTypeGate from './components/OrderTypeGate';
import Embers from './components/Embers';
import { useCatalog } from './context/CatalogContext';
import Home from './pages/Home';
import Menu from './pages/Menu';
import Checkout from './pages/Checkout';
import OrderStatus from './pages/OrderStatus';
import TrackOrder from './pages/TrackOrder';
/*
 * The admin panel is loaded on demand.
 *
 * It is roughly half the application — the menu editor, the banner editor
 * with its live preview, the kitchen screen and the revenue chart — and no
 * customer ever opens it. Bundling it with the storefront made every visitor
 * download the shop's back office before they could look at a burger.
 */
const AdminAuthProvider = lazy(() =>
  import('./admin/AdminAuth').then((m) => ({ default: m.AdminAuthProvider })),
);
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const AdminOrders = lazy(() => import('./admin/AdminOrders'));
const AdminMenu = lazy(() => import('./admin/AdminMenu'));
const AdminBanners = lazy(() => import('./admin/AdminBanners'));
const AdminHours = lazy(() => import('./admin/AdminHours'));
const AdminReports = lazy(() => import('./admin/AdminReports'));

export default function App() {
  // The admin panel needs the unpublished rows too, so the catalog is loaded
  // differently for it. Decided here rather than inside the provider because
  // it changes which endpoint is called, not just what is rendered.
  const isAdmin = useLocation().pathname.startsWith('/admin');

  return (
    <CatalogProvider admin={isAdmin}>
      <OrderProvider>
        <CartProvider>
          <AppShell isAdmin={isAdmin} />
        </CartProvider>
      </OrderProvider>
    </CatalogProvider>
  );
}

function AppShell({ isAdmin }) {
  const { bannerSettings, loading, error, reload } = useCatalog();

  if (isAdmin) {
    // No decorative effects in the admin panel — it is a working tool, and
    // the kitchen screen should spend nothing on animation.
    return (
      <Suspense fallback={<FullPageMessage>Loading the admin panel…</FullPageMessage>}>
        <AdminAuthProvider>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOrders />} />
              <Route path="menu" element={<AdminMenu />} />
              <Route path="banners" element={<AdminBanners />} />
              <Route path="hours" element={<AdminHours />} />
              <Route path="reports" element={<AdminReports />} />
            </Route>
          </Routes>
        </AdminAuthProvider>
      </Suspense>
    );
  }

  // Before the menu has loaded there is nothing honest to show: the seed data
  // behind the snapshot is a starting point for a fresh install, not this
  // shop's menu, and letting a customer build a basket from it would mean
  // prices that do not match what the server will charge.
  if (loading) return <FullPageMessage>Loading the menu…</FullPageMessage>;

  if (error) {
    return (
      <FullPageMessage title="We can't load the menu">
        <p className="mt-2 text-ink-500">{error.message}</p>
        <button type="button" onClick={reload} className="btn-primary mt-6">
          Try again
        </button>
      </FullPageMessage>
    );
  }

  return (
    <>
      {bannerSettings.areEmbersOn && <Embers intensity={bannerSettings.emberIntensity} />}

      {/* Above the ember layer, which is z-0 and fixed. */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <PromoBanner />
        <Header />
        <ServiceBar />

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/order/:reference" element={<OrderStatus />} />
            <Route path="/track" element={<TrackOrder />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <Footer />
      </div>

      <OrderTypeGate />
      <CartDrawer />
    </>
  );
}

function FullPageMessage({ title, children }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        {title ? (
          <h1 className="text-3xl text-ink-950">{title}</h1>
        ) : (
          <p className="text-sm text-ink-500">{children}</p>
        )}
        {title && children}
      </div>
    </div>
  );
}
