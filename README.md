# UFF - Ultra Fast Fluency

![UFF Loading](assets/img/u-f-f.png)

## Overview

**UFF (Ultra Fast Fluency)** is a revolutionary web-based English language learning platform designed to fundamentally change how students learn to speak English. Unlike traditional methods or popular apps that focus heavily on reading, writing, and multiple-choice questions (often featuring unnatural, synthesized voices), UFF is strictly focused on **speaking and listening** in real-world scenarios.

The core philosophy of UFF is that fluency is achieved by listening to native speakers speak at normal speeds and responding naturally with your own voice. The technology evaluates your verbal responses in real-time, focusing not just on grammar, but on semantic intent and pragmatics.

## Key Features

*   **100% Real-World Media:** UFF exclusively uses video clips of native speakers (from movies, series, and YouTube) speaking naturally. There are zero synthesized voices, "teacher English," or unnaturally slow speech.
*   **Voice-First Interaction:** You answer by speaking. The platform uses speech-to-text to capture your response, meaning no multiple-choice questions.
*   **AI-Powered Evaluation:** Instead of rigid "exact match" grading, UFF uses AI to evaluate if your response makes sense in the context of the conversation (Intent) and if it is grammatically correct.
*   **The UFF FluenScore™:** A proprietary metric (from 0% to 100%) that measures your actual ability to communicate in real-life situations, rather than just your theoretical CEFR level. It evaluates comprehension, response appropriateness, and speed.
*   **Offline/Guest Mode Support:** The app supports a lazy login/guest mode, keeping users engaged before they even create an account. Data synchronizes once an account is established.

## Architecture & Tech Stack

UFF is built as a highly responsive, static frontend application with a decoupled BaaS (Backend-as-a-Service) architecture.

### Frontend
*   **HTML/CSS/Vanilla JS:** No heavy framework is used, ensuring blazing fast load times and straightforward DOM manipulation.
*   **Styling & UI:** Built with **Bootstrap 5**, Bootstrap Icons, and Animate.css for standard, smooth UI animations.
*   **Direct-Mutation State Management:** The application manages global state via a centralized `State` object (`js/modules/state.js`).

### Backend & Authentication
*   **Appwrite (v24):** Used for user authentication, session management, and database synchronization (`js/modules/appwrite.js`).
*   **Local Storage Sync:** Guest and offline progress is stored locally and synced to Appwrite upon login (`js/modules/userProfile.js`).

### AI & NLP Pipeline
*   **Speech-to-Text:** Integrated with Deepgram and Whisper for highly accurate, fast transcription.
*   **Background NLP Worker:** Heavy NLP tasks (like local Hugging Face model inferences and text normalization) are offloaded to a Web Worker (`js/nlp-worker.js`) so the main UI thread never freezes.
*   **Grammar & Intent Checking:** External APIs and proxy workers (e.g., Cloudflare Workers interacting with AI models) are queried to evaluate semantic correctness (`js/modules/api.js`).

## Directory Structure

```text
.
├── README.md               # This file
├── index.html / homescreen.html # Main entry points
├── landing.html            # Marketing and informational landing page
├── lesson.html             # The core interactive lesson interface
├── userprofile.html        # User statistics and history
├── style.css               # Global application styles
├── assets/                 # Images, icons, and audio/video fallbacks
│   ├── img/
│   ├── sounds/
│   └── ...
└── js/                     # Application logic
    ├── config/             # JSON configuration files (e.g., courses)
    ├── data/               # Static lesson data and dictionaries
    ├── modules/            # Modularized logic (State, API, UI, Scoring)
    │   ├── api.js          # API calls (AI evaluation, deepgram tokens)
    │   ├── appwrite.js     # Appwrite backend client setup
    │   ├── state.js        # Global application state object
    │   ├── ui.js           # Visual rendering and DOM manipulation
    │   └── ...
    ├── nlp-worker.js       # Background thread for heavy language processing
    └── script.js           # Main application bootstrapping
```

## Local Development Setup

Because UFF is designed as a static frontend, setting it up for local development is extremely simple. No build step (like Webpack or Vite) is strictly required for the core app, though you need a local server to avoid CORS issues with ES Modules and Web Workers.

### Prerequisites
*   A basic HTTP server (e.g., Python, Node `http-server`, or Live Server in VS Code).

### Running the App
1. Clone the repository to your local machine.
2. Open a terminal in the root directory of the project.
3. Start a local HTTP server. For example, using Python:
   ```bash
   python3 -m http.server 8000
   ```
4. Open your browser and navigate to `http://localhost:8000/landing.html` or `http://localhost:8000/homescreen.html`.

### Testing Media & Speech locally
To properly test the microphone and speech recognition features (especially in automated tests like Playwright), you may need to bypass standard browser security prompts for local environments.
If launching Chromium via Playwright, pass these arguments:
`['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']`
and explicitly grant `['microphone']` permissions in the browser context.

## Contact & Support

**Created by Joe Walsh**
*The first technology designed specifically for English fluency. Transform your speaking ability in days, not years.*

*   **Support Email:** support@uff.com
*   **Phone (WhatsApp):** +1 (617) 903-0597
*   **Location:** Boston, USA
