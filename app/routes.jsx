import { Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import LessonContainer from '../js/components/LessonContainer.jsx';

function LessonError() {
  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100">
      <h2>Lesson not found</h2>
      <p>The course or lesson you requested does not exist.</p>
      <a href="/" className="btn btn-primary">Go Home</a>
    </div>
  );
}

// TODO: Replace wildcard hardcoded redirect with a proper home/default route
export const routes = [
  {
    path: '/course/:courseId/lesson/:lessonId',
    element: <AppLayout />,
    errorElement: <LessonError />,
    children: [
      { index: true, element: <LessonContainer /> }
    ]
  },
  {
    path: '*',
    element: <Navigate to="/course/gt2/lesson/a" replace />
  }
];
