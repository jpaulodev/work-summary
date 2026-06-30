import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import Layout from './routes/layout';
import Login from './routes/login';
import Dashboard from './routes/dashboard';
import Sources from './routes/sources';
import Notifications from './routes/notifications';
import Runs from './routes/runs';
import Settings from './routes/settings';
import './index.css';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'sources', element: <Sources /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'runs', element: <Runs /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
