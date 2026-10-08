import { Navigate, Link } from 'react-router-dom';
import RootLayout from './RootLayout.jsx';
import AppLayout from './AppLayout.jsx';
import AuthLayout from './AuthLayout.jsx';
import HomeRoute from './HomeRoute.jsx';
import PublicHomeRoute from './PublicHomeRoute.jsx';
import ProfileRoute from './ProfileRoute.jsx';
import LoginRoute from './LoginRoute.jsx';
import SignupRoute from './SignupRoute.jsx';
import RecoverPasswordRoute from './RecoverPasswordRoute.jsx';
import ResetPasswordRoute from './ResetPasswordRoute.jsx';
import ConfirmEmailRoute from './ConfirmEmailRoute.jsx';
import LessonContainer from '../components/LessonContainer.jsx';
import PublicProfileRoute from './PublicProfileRoute.jsx';
import PrivacyRoute from './PrivacyRoute.jsx';
import TermsRoute from './TermsRoute.jsx';
import CoursesRoute from './CoursesRoute.jsx';

function LessonError() {
  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100">
      <h2>Lesson not found</h2>
      <p>The course or lesson you requested does not exist.</p>
      <Link to="/home" className="btn btn-primary">Go Home</Link>
    </div>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <PublicHomeRoute /> },
      { path: '/home', element: <HomeRoute /> },
      { path: '/login', element: <AuthLayout />, children: [{ index: true, element: <LoginRoute /> }] },
      { path: '/signup', element: <AuthLayout />, children: [{ index: true, element: <SignupRoute /> }] },
      { path: '/recover-password', element: <AuthLayout />, children: [{ index: true, element: <RecoverPasswordRoute /> }] },
      { path: '/reset-password', element: <AuthLayout />, children: [{ index: true, element: <ResetPasswordRoute /> }] },
      { path: '/profile', element: <ProfileRoute /> },
      // Legal pages must precede the single-segment /:shareCode catch-all.
      { path: '/privacy', element: <PrivacyRoute /> },
      { path: '/terms', element: <TermsRoute /> },
      // Public: the confirmation link is opened without a session. Must precede
      // the single-segment /:shareCode catch-all like the legal pages.
      { path: '/confirm-email', element: <AuthLayout />, children: [{ index: true, element: <ConfirmEmailRoute /> }] },
      // Public course listings must precede the single-segment /:shareCode
      // catch-all like the legal pages, or `courses` is read as a share code.
      { path: '/courses', element: <CoursesRoute /> },
      { path: '/course/:courseId/lesson/:lessonId', element: <AppLayout />, errorElement: <LessonError />, children: [{ index: true, element: <LessonContainer /> }] },
      { path: '/:shareCode', element: <PublicProfileRoute /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
