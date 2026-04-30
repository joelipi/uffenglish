import sys
print("""
1. Modify `js/modules/speech.js` to decouple it from direct DOM manipulation:
   - Identify all functions manipulating `document.querySelector`, `document.getElementById`, `innerHTML`, `classList`, `style`.
   - Update those functions to call exported functions from `js/modules/ui.js` instead.
   - Refactor `createWebcamPreview`, `ensureWebcamPreview`, `removeWebcamPreview` and `clearPlaybackVideo` to operate without direct DOM manipulation.
2. Modify `js/modules/ui.js` to expose necessary DOM manipulation functions:
   - Create functions to handle `webcamPreview` creation, display, and removal.
   - Create functions to handle `playbackVideo` logic, muting/unmuting, and visibility toggles.
   - Update `toggleSpeechRecognition` UI reviews step (`reviewProgressBar`, `reviewTimer`, `acceptBtn`, `rejectBtn`) to be handled inside `ui.js`.
3. Test locally by running `python3 -m http.server 8000` and testing the site functionality.
4. Pre-commit check and then Submit changes.
""")
