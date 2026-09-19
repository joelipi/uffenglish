# UFF — Ultra Fast Fluency

UFF is a web app for building English fluency through speaking and listening: native-speaker video lessons, voice-first answers, and on-device AI evaluation of intent, grammar, and delivery, summarized as a 0–100 fluency score. Learners record themselves per step and receive a shareable end-of-lesson recap video. The friend-challenge loop lets a learner invite a friend to answer their recorded questions within a 48-hour window.

## Features

- **Voice-first lessons** — native-speaker video prompts with spoken answers evaluated by on-device Whisper + AI; fluency score 0–100 per lesson.
- **Bilingual overlays** — cues and subtitles localized to the learner's L1 (en/es/pt/fr, plus targeted hi/bn keys).
- **Lesson recap video** — client-side stitched end-of-lesson recap (model prompts + own recordings) with a fluency score card, generated via canvas + MediaRecorder.
- **Friend challenge lessons** — "Ask" lessons (`w`/`wf`) publish the asker's 3 question clips to R2 (48h TTL); friends answer them in `wa`/`wfa` via a `?sharecode=` URL.
- **webcamOnly share-CTA recap** — ask-only lessons render a webcam-only "ad" recap with a localized headline, 48h deadline, and single-line share URL ([story](stories/001-webcam-only-share-cta/story.md)).
- **Text-mode fallback** — last-resort typed answers render avatar-card segments in the recap; text is only offered after the speech engine definitively fails (voice-first product rule).
- **Guest + Supabase auth** — guest flow with language picker; Supabase accounts get a shareCode, profile, and R2 publish rights.

## Non-Goals

- No text-mode publishing path — typed answers are a practice fallback, never shareable UGC.
- No full localization beyond en/es/pt/fr (plus targeted hi/bn keys); profile supports many more locales than the UI is translated into.
- No React Native feature parity — web-first; native video export is disabled.
- No server-side video rendering — recaps are generated entirely client-side.

## Known Limitations

- Text-mode users cannot publish clips (null blobs are filtered from the R2 export), so a friend opening their share URL gets a 404 lesson; the share CTA still renders over their avatar-card recap.
- `hi`/`bn` are partial localizations — most UI strings fall back to English for those users.
- Playwright's bundled Chromium lacks H.264/AAC codecs; video specs must run real Chrome (`agents.md` §5).
- The R2 UGC 48h TTL is configured in the Cloudflare dashboard, not in `wrangler.toml` (`README.md:98`).
