import { Route, Routes } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth } from './auth/RouteGuards';
import { Layout } from './components/Layout';
import { CallPage } from './pages/CallPage';
import { EditMeetingPage } from './pages/EditMeetingPage';
import { LoginPage } from './pages/LoginPage';
import { MeetingDetailPage } from './pages/MeetingDetailPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { NewMeetingPage } from './pages/NewMeetingPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';

/** The route table. Providers (router, auth, translations) are set up by the caller. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route index element={<MeetingsPage />} />
          <Route path="/meetings/new" element={<NewMeetingPage />} />
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
          <Route path="/meetings/:id/edit" element={<EditMeetingPage />} />
          <Route path="/meetings/:id/call" element={<CallPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
