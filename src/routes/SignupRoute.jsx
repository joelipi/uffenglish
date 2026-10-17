import { Navigate } from 'react-router-dom';
import { COURSES_PATH } from '../modules/courses/guest-viewer-logic.js';

// Story 070 — the standalone signup page is CLOSED, not deleted.
//
// Accounts are created at the end of the first lesson
// (`SuccessButtons` -> `SaveClipsModal` -> `SaveClipsSignupForm`), and the
// guest modal, the login page's sign-up link and the guest profile all land
// here, so this is the single funnel entry point that has to be shut. It
// redirects to the course list, where that flow starts and where the
// signed-out notice explains it.
//
// Nothing is removed: `SignupForm.web.jsx` is untouched and still carries the
// full signup (email gate, profile write, grid layout). To reopen, render
// `SignupForm` here again and honour the `?redirect=` search param the entry
// points used to pass — nothing else needs restoring.
export default function SignupRoute() {
    return <Navigate to={COURSES_PATH} replace />;
}
