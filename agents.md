# Agent Instructions (`agents.md`)

## 1. Code Architecture & Organization
* **Strict Separation of Concerns:** Maintain a highly modular codebase. Do not place logic in a module where it does not conceptually belong.
* **Resource & Cost Optimization:** Minimize read/write operations to the Appwrite database. To save costs and lay the groundwork for a future offline mode, prioritize running operations within browser memory using the local client-side models instead of making external API calls to server-side LLMs. Balance this local-first approach with the need to avoid overloading the user's device resources (CPU/memory).
* **CSS Consolidation:** Consolidate all styling into the `styles.css` file. Avoid inline styles or creating fragmented CSS files unless strictly required by a specific framework component.
* **Leverage Bootstrap:** Use built-in Bootstrap classes and UI elements whenever possible rather than writing custom CSS, to keep the codebase lean and prevent bulking up the code.
* **Appwrite & Dependencies:** Always perform a web search to check the current version and documentation for Appwrite before writing or modifying related code. Appwrite has had major updates with breaking changes, and your baseline LLM knowledge is likely out of date.
* **Version Control:** Note that the primary branch is `main`.

## 2. Comments & Logging
* **Preserve Comments:** NEVER delete existing code comments unless explicitly instructed to do so.
* **Preserve Console Logs:** Do **NOT** remove existing `console.log` statements unless explicitly instructed to do so.
* **Implement Debug & Success Logging:** Write code with comprehensive error handling, detailed debug logging, AND "success" logging so it is immediately clear when a specific event or function has successfully fired.

## 3. Autonomy & Approvals
* **Fast Iteration:** Do not ask for user approval for small, incremental changes or routine bug fixes. Execute them immediately.
* **Major Changes:** You must pause and ask for confirmation only for major decisions, such as adding new dependencies, altering the core architecture, or completely rewriting established modules.

## 4. Testing & Console Monitoring
* **Automated Browser Testing:** Use your built-in browser and testing capabilities to verify front-end functionality and HTML/JS interactions.
* **Strict Console Inspection:** During testing runs, actively monitor the console. You must look for and resolve:
    * Console errors.
    * Console warnings.
* **Verify Expected Logs:** Check for expected console logs (both debug and success logs). If a process runs but fails to output a log that is expected to fire, you must treat this as a bug and review the code.

Do not go to homescreen.html or landing.html they aren't hooked into the app logic yet.

Here is the local address of the course and lesson I am using for testing http://127.0.0.1:5500/lesson.html?courseid=gt2&lessonid=x Remember that lessons cannot be initialized without that url parameter unless they are already stored in memory.

## 5. App-Specific Testing Workarounds
* **Speech-to-Text / Microphone Bypass:** Because you cannot natively utilize a microphone for the speech-to-text features, you must use the built-in testing functions. As appropriate, bypass the microphone entirely or directly invoke the `handleAnswer` function (or other required functions) to simulate user audio input.
* **Authentication / Login Testing:** 
AVOID logging into the web app as a user for now, since this will interfere with your ability to test the app as a guest user. It will not be an issue in the live version of the application. ONLY LOG IN OR SIGN UP IF THE TASK SPECIFICALLY REQUIRES IT.
User credentials for the web app during your automated testing:
    * **Email:** jules@example.com
    * **Password:** testtest