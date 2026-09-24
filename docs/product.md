# UFF — Ultra Fast Fluency

**UFF (Ultra Fast Fluency)** is a web app for learning English fluency through speaking and listening. Learners work through video lessons built around a native-speaker role play, answer voice-first, and receive AI evaluation of intent/grammar plus a fluency score (0–100). It is built for learners who want to speak rather than tap through drills. Learners record themselves per step and receive a shareable end-of-lesson recap video; the friend-challenge loop lets a learner invite a friend to answer their recorded questions within a 48-hour window.

## Features

- **Voice-first role-play lessons** — native-speaker video sets the context, the learner answers by voice, and speech-to-text plus AI feedback scores each response ([answer-flow](tests/answer-flow.spec.js)).
- **Bilingual overlays** — cues and subtitles localized to the learner's L1 (en/es/pt/fr, plus targeted hi/bn keys).
- **Auto-generated simple-video captions** — new `simpleVideoUrl` videos get English SRT from local Whisper plus DeepSeek translations to es/pt/fr/hi/bn, committed to the branch on push ([story](stories/009-auto-caption-simple-videos/story.md)).
- **Lesson recap video** — client-side stitched end-of-lesson recap (model prompts + own recordings) with a fluency score card, generated via canvas + MediaRecorder.
- **Friend Challenge lessons** — `w`/`wf` let a learner record "Would you rather?" questions, share a link, and `wa`/`wfa` let a friend answer; the two clips are concatenated. The asker's 3 question clips publish to R2 (48h TTL) and friends answer them via a `?sharecode=` URL.
- **Friend-challenge practice link** — after an ask video is exported, the creator's public profile (`/:shareCode`) shows a large "Practice English with Me" link to the matching answer lesson, with a 48h countdown that removes it when the R2 clips expire ([story](stories/012-friend-lesson-link/story.md)).
- **Auto-advancing friend answers** — answering a friend's question correctly advances straight to the next step with no feedback pause; incorrect answers retry via the hangman hint until correct ([story](stories/005-skip-friend-feedback/story.md)).
- **Share-CTA recap** — ask-only lessons render a webcam-only "ad" recap with a localized headline, 48h deadline, and single-line share URL ([story](stories/001-webcam-only-share-cta/story.md)).
- **Per-lesson recap controls** — each lesson's recap overlay (`recapOverlay`: `fluency` / `shareCta` / `none`) and concatenated prompt sources (`recapSources`: `system` / `friend` / `none`) are configured per lesson and are independent; the former `webcamOnly` flag is retired ([story](stories/010-recap-overlay-flag/story.md)).
- **Static intro-video step** — `wf` replays the intro clip as a non-interactive step with localized subtitles before the first recording step ([story](stories/003-add-wf-video-player-step/story.md)).
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
- Playwright's bundled Chromium lacks H.264/AAC codecs; video specs must run real Chrome (`agents.md` §5).
- The R2 UGC 48h TTL is configured in the Cloudflare dashboard, not in `wrangler.toml` (`README.md:98`).
- Classroom/staging testing depends on R2 availability; video playback cannot be fully verified offline.
