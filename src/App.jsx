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
import { AdminAuthProvider } from './admin/AdminAuth';
import AdminLayout from './admin/AdminLayout';
import AdminOrders from './admin/AdminOrders';
import AdminMenu from './admin/AdminMenu';
import AdminBanners from './admin/AdminBanners';
import AdminHours from './admin/AdminHours';
import AdminReports from './admin/AdminReports';

export default function App() {
  return (
    <CatalogProvider>
      <OrderProvider>
        <CartProvider>
          <AppShell />
        </CartProvider>
      </OrderProvider>
    </CatalogProvider>
  );
}

function AppShell() {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const { bannerSettings } = useCatalog();

  if (isAdmin) {
    // No decorative effects in the admin panel — it is a working tool, and
    // the kitchen screen should spend nothing on animation.
    return (
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
