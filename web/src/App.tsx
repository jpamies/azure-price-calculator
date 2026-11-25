import { lazy } from "react";
import { RouterProvider, createHashRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadAboutPage, loadEstimatePage, loadHomePage, loadSettingsPage } from "@/pages/loaders";
import NotFoundPage from "@/pages/NotFoundPage";
import RouteErrorPage from "@/pages/RouteErrorPage";

// One chunk per page; the shell renders a skeleton (Suspense) while a page chunk downloads.
const HomePage = lazy(loadHomePage);
const EstimatePage = lazy(loadEstimatePage);
const SettingsPage = lazy(loadSettingsPage);
const AboutPage = lazy(loadAboutPage);

// Hash routes (#/, #/estimate/:id, #/settings, #/about) work on GitHub Pages without server rewrites.
// Share links use the query string (?s=…), handled by <SharedEstimateImport> inside the shell.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        // Page-level errors render inside the shell (top bar and navigation stay usable).
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "estimate/:id", element: <EstimatePage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "about", element: <AboutPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
