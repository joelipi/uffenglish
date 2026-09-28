# UFF — Ultra Fast Fluency

**UFF (Ultra Fast Fluency)** is a web app for learning English fluency through speaking and listening. Learners work through video lessons built around a native-speaker role play, answer voice-first, and receive AI evaluation of intent/grammar plus a fluency score (0–100). It is built for learners who want to speak rather than tap through drills. Learners record themselves per step and receive a shareable end-of-lesson recap video; the friend-challenge loop lets a learner invite a friend to answer their recorded questions within a 48-hour window.

## Features

- **Voice-first role-play lessons** — native-speaker video sets the context, the learner answers by voice, and speech-to-text plus AI feedback scores each response ([answer-flow](tests/answer-flow.spec.js)).
- **Bilingual overlays** — cues and subtitles localized to the learner's L1 (en/es/pt/fr, plus targeted hi/bn keys).
- **Auto-generated simple-video captions** — new `simpleVideoUrl` videos get English SRT from local Whisper plus DeepSeek translations to es/pt/fr/hi/bn, committed to the branch on push ([story](stories/009-auto-caption-simple-videos/story.md)).
- **Lesson recap video** — client-side stitched end-of-lesson recap (model prompts + own recordings) with a fluency score card, generated via canvas + MediaRecorder.
- **Prominent concat button on the success screen** — the end-of-lesson "make my video" trigger stays hidden while the short success clip plays, then is revealed as a large, glowing CONTINUE call-button under a water overlay that invites the learner to create and share their video, matching the earlier decision steps ([story](stories/011-enlarge-concat-button/story.md)).
- **Landscape recording warning** — on iOS/Android, a dismissible banner tells the learner to rotate the device to portrait while it is held landscape, so recorded clips keep the intended 9:16 framing ([story](stories/015-warn-landscape-recording/story.md)).
- **Friend Challenge lessons** — `w`/`wf` let a learner record "Would you rather?" questions, share a link, and `wa`/`wfa` let a friend answer; the two clips are concatenated. The asker's 3 question clips publish to R2 (48h TTL) and friends answer them via a `?sharecode=` URL.
- **Friend-challenge practice link** — after an ask video is exported, the creator's public profile (`/:shareCode`) shows a large "Practice English with Me" link to the matching answer lesson, with a 48h countdown that removes it when the R2 clips expire ([story](stories/012-friend-lesson-link/story.md)).
- **Friend-response notifications** — when a friend opens an asker's share link and exports the answer video, the asker gets an in-app notification in a bell menu on the home screen, linking to the friend's public profile (`/<shareCode>`) and reminding them they have 48 hours to respond (the line hides once the R2 clip window closes); notifications are stored in Supabase, deduped per friend+course+lesson, and mark-as-read ([story](stories/019-notify-share-link-video-created/story.md)).
- **Auto-advancing friend answers** — answering a friend's question correctly advances straight to the next step with no feedback pause; incorrect answers retry via the hangman hint until correct ([story](stories/005-skip-friend-feedback/story.md)).
- **Low-friction friend lessons** — a lesson opened via a friend link (`?shareCode=`) or with lesson id `a`/`b` never auto-opens the guest login step: a non-English browser language is adopted silently, and only an English browser sees the language-confirmation step (which then closes, no Log In / Sign Up prompt). Login stays available after recording or from the menu ([story](stories/016-friend-lesson-modals/story.md)).
- **Correction card dismisses on re-record** — the "Try again" hangman correction card hides as soon as the learner presses the microphone button to record their retry ([story](stories/014-hide-correction-box-on-re-record/story.md)).
- **Share-CTA recap** — ask-only lessons render a webcam-only "ad" recap with a localized headline, 48h deadline, and single-line share URL ([story](stories/001-webcam-only-share-cta/story.md)).
- **Per-lesson recap controls** — each lesson's recap overlay (`recapOverlay`: `fluency` / `shareCta` / `none`) and concatenated prompt sources (`recapSources`: `system` / `friend` / `none`) are configured per lesson and are independent; the former `webcamOnly` flag is retired ([story](stories/010-recap-overlay-flag/story.md)).
- **Static intro-video step** — `wf` replays the intro clip as a non-interactive step with localized subtitles before the first recording step ([story](stories/003-add-wf-video-player-step/story.md)).
- **Uniform R2-only video posters** — every poster is a 0.2s still of its video and is the video's URL with `.mp4`→`.jpg` (`getPosterUrl(slug) = getVideoUrl(slug).replace('.mp4','.jpg')`); teacher/lesson-intro posters for every `src/config/*.json` course are generated and uploaded on push by `deploy.yml`, and user-generated friend clips upload a sibling `.jpg` at publish time. No posters are committed to the repo or served locally ([story](stories/011-auto-intro-poster/story.md)).
- **Text-mode fallback** — last-resort typed answers render avatar-card segments in the recap; text is only offered after the speech engine definitively fails (voice-first product rule).
- **Guest mode** — learners can start a lesson without logging in; UI strings and lesson content fall back to English when a translation is missing. Supabase accounts get a shareCode, profile, and R2 publish rights.

## Non-Goals

- Native mobile apps — the codebase targets the web; React Native variants exist but are not shipped.
- No text-mode publishing path — typed answers are a practice fallback, never shareable UGC.
- Real-time human tutoring or live conversation.
- Authoring tools for teachers; lesson content is edited directly in `src/config/*.json`.
- No full localization beyond en/es/pt/fr (plus targeted hi/bn keys); profile supports many more locales than the UI is translated into.
- No server-side video rendering — recaps are generated entirely client-side.

## Known Limitations

- Text-mode users cannot publish clips (null blobs are filtered from the R2 export), so a friend opening their share URL gets a 404 lesson; the share CTA still renders over their avatar-card recap.
- `hi`/`bn` are partial localizations — most UI strings fall back to English for those users.
- Speech recognition runs Whisper in-browser and requires COOP/COEP and cross-origin headers; videos and Whisper fail on staging without the Cloudflare Transform Rules (`docs/cloudflare-video-cors.md`).
- Mic/camera cannot be exercised headlessly; many flows require the documented test bypasses (`agents.md`).
- Lesson media is hosted on Cloudflare R2 (`assets/videos/<slug>.mp4`); video files are gitignored (too large for the repository) and uploaded out of band, so lesson video playback depends on R2 availability and on the real recordings having been uploaded.
- Lesson-intro posters follow the same `<video>.jpg` sibling rule and are R2-only (`assets/videos/<slug>.jpg` for teacher intros, `videos/<…>.jpg` for UGC); teacher posters are generated/uploaded on push for every course and UGC posters at publish, so nothing is committed or served locally and a poster is only as available as R2 ([story](stories/011-auto-intro-poster/story.md)).
- The lesson-intro overlay no longer shows a caller name/title — the hardcoded "Joe Walsh / English Coach, UFF" was removed because it is wrong for friend/UGC intros. Surfacing the friend's own name (from their profile, via the share code) is deferred ([story](stories/013-remove-intro-caller-name/story.md)).
- Playwright's bundled Chromium lacks H.264/AAC codecs; video specs must run real Chrome (`agents.md` §5).
- The R2 UGC 48h TTL is configured in the Cloudflare dashboard, not in `wrangler.toml` (`README.md:98`).
- Classroom/staging testing depends on R2 availability; video playback cannot be fully verified offline.
- "Friend lesson" detection is route-based (`?shareCode=` in the URL, or a lesson whose id is `a`/`b`) and does not include the course id, because course ids are open-ended. As a result the ordinary lessons `a` in `model.json` and `gt2.json` are also treated as friend lessons and skip the automatic guest login/language prompt ([story](stories/016-friend-lesson-modals/story.md)).
- A guest who silently adopts a browser language on a friend lesson and then logs in within the same SPA session can keep that adopted language in memory until the next full page load; a page load while already logged in uses the profile language and skips all friend-lesson logic ([story](stories/016-friend-lesson-modals/story.md)).
