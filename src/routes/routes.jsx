import { Navigate, Link } from 'react-router-dom';
import RootLayout from './RootLayout.jsx';
import AppLayout from './AppLayout.jsx';
import AuthLayout from './AuthLayout.jsx';
import HomeRoute from './HomeRoute.jsx';
import ProfileRoute from './ProfileRoute.jsx';
import LoginRoute from './LoginRoute.jsx';
import SignupRoute from './SignupRoute.jsx';
import RecoverPasswordRoute from './RecoverPasswordRoute.jsx';
import ResetPasswordRoute from './ResetPasswordRoute.jsx';
import LessonContainer from '../components/LessonContainer.jsx';

function LessonError() {
  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100">
      <h2>Lesson not found</h2>
      <p>The course or lesson you requested does not exist.</p>
      <Link to="/" className="btn btn-primary">Go Home</Link>
    </div>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomeRoute /> },
      { path: '/login', element: <AuthLayout />, children: [{ index: true, element: <LoginRoute /> }] },
      { path: '/signup', element: <AuthLayout />, children: [{ index: true, element: <SignupRoute /> }] },
      { path: '/recover-password', element: <AuthLayout />, children: [{ index: true, element: <RecoverPasswordRoute /> }] },
      { path: '/reset-password', element: <AuthLayout />, children: [{ index: true, element: <ResetPasswordRoute /> }] },
      { path: '/profile', element: <ProfileRoute /> },
      { path: '/course/:courseId/lesson/:lessonId', element: <AppLayout />, errorElement: <LessonError />, children: [{ index: true, element: <LessonContainer /> }] },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
