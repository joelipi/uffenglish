<!--
  TEMPLATE / DRAFT — NOT LEGAL ADVICE.
  This document is assembled from widely used privacy-policy boilerplate
  (GDPR/CCPA-style structure) and describes UFF's actual data practices, but it
  has not been reviewed by a licensed attorney. Have counsel review it (and the
  companion Terms of Service) before publishing, especially the marketing,
  children's-privacy, arbitration, and international-transfer clauses.
  Replace every bracketed placeholder (e.g. [LEGAL ENTITY ADDRESS]).
-->

# UFF Privacy Policy

**Effective date:** October 4, 2026
**Last updated:** October 4, 2026

This Privacy Policy explains how UFF ("**UFF**," "**we**," "**us**," or "**our**") collects, uses, discloses, and safeguards your information when you use the UFF website, web app, and related services (the "**Service**"). UFF is operated by Joe Walsh, Boston, Massachusetts, USA.

By using the Service, you agree to the collection and use of information in accordance with this Privacy Policy. If you do not agree, please do not use the Service.

**Contact:** mrjoewalsh1@gmail.com · [LEGAL ENTITY ADDRESS]

---

## 1. Summary of Key Points

- We collect account details, lesson activity, and the audio, video, and text you create while practicing ("**User Content**").
- We use your data to run the Service, evaluate your answers with AI, generate your recap and friend-challenge videos, improve the product, and — only where permitted — send you marketing.
- **We do not sell your personal information.** We do not share your email address with unaffiliated third parties so that they can market their own products to you unless you give us permission.
- Published videos and friend-challenge clips are stored on Cloudflare R2 and are automatically **deleted after 48 hours**. A single still image (poster) may be saved to your profile picture.
- AI evaluation is performed by sending the **text** of your response (not your raw audio/video) to our AI processor, DeepSeek.
- You have rights to access, correct, delete, and restrict use of your information. See Section 10.

This summary is for convenience only; the full Policy below governs.

---

## 2. Information We Collect

### 2.1 Information you provide directly

| Category | Examples | When collected |
|---|---|---|
| Account & profile | First name, last name, email address, password (stored hashed), native language, English proficiency level, profile picture | Sign-up, profile editing |
| User Content | Voice recordings, webcam video recordings, on-device speech-to-text transcripts, typed answers, generated recap videos, thumbnails/posters | While practicing / finishing a lesson |
| Communications | Support emails, feedback, survey responses | When you contact us |
| Marketing preferences | Email opt-in/opt-out status | When you subscribe or unsubscribe |

### 2.2 Information we collect automatically

- **Activity and progress data** — lessons started and completed, scores, fluency metrics, interaction statistics, timestamps, and share codes.
- **Sign-up metadata** — IP address, country, region, city (obtained through the third-party geolocation service ipapi.co), and the referrer or friend code that brought you to us.
- **Device and usage data** — browser and device type, operating system, language settings, pages viewed, and interactions, collected through cookies, local storage, and similar technologies.
- **Analytics and diagnostics** — product analytics events, session replays, error/exception logs, and performance data (see Section 5).
- **In-app notifications** — a record of friend-challenge notifications and whether you have read them.

### 2.3 Information from third parties

- **Friend challenges** — if you open a friend's share link, we associate your activity with that share code so the challenge works.
- **Authentication provider** — Supabase provides authentication and may return your email address and user identifier.

We do not intentionally collect "sensitive" categories such as government identifiers, precise financial information, or health data. Voice and video recordings may reveal personal characteristics (such as your appearance or accent); you choose whether to provide them.

---

## 3. How We Use Your Information

We use your information for the following purposes and on the following legal bases (where required by law):

| Purpose | Legal basis |
|---|---|
| Create and manage your account; provide lessons, scoring, and progress tracking | Performance of our contract with you |
| Process and evaluate your responses, including AI evaluation and tutoring | Contract; legitimate interests in operating an educational service |
| Generate, store, and (when you ask) share your recap and friend-challenge videos | Contract; your instructions |
| Operate friend-challenge features and public profile pages you create | Contract |
| Analyze usage, debug, secure, and improve the Service | Legitimate interests |
| Send service and account messages (password resets, important notices) | Contract; legal obligation |
| Send marketing and promotional emails | Consent where required; otherwise legitimate interests, always with opt-out |
| Comply with law, enforce our Terms, and prevent abuse | Legal obligation; legitimate interests |

---

## 4. User-Generated Content (Recordings & Videos)

This section explains specifically what happens to the recordings and videos you create. It supplements, and should be read together with, the User Content provisions in our Terms of Service.

**What User Content includes.** Voice recordings, webcam video, on-device speech-to-text transcripts, typed answers, generated recap videos, trimmed per-segment clips, and still thumbnails/posters.

**Ownership.** You retain ownership of your User Content. We do not claim ownership of your recordings. You grant us the limited license described in the Terms of Service so that we can host, process, and show your content back to you and to the people you choose to share it with.

**On-device processing.** Speech-to-text is performed by a Whisper speech model running **in your browser**. Your raw audio is processed locally for transcription. Audio and video files are not uploaded to us unless you finish a lesson that publishes clips or generates a recap.

**AI evaluation.** To evaluate your answers and provide tutoring, our systems send the **text** of your response and related lesson context (such as the prompt and the lesson goal) to our AI processor, which forwards it to **DeepSeek**, a third-party AI provider. We do not send your raw audio or video to the AI provider. See Section 5.

**Storage and retention.**
- Published friend-challenge clips and end-of-lesson "complete" videos are uploaded to our **Cloudflare R2** object storage and are automatically deleted **48 hours** after upload.
- A single still image (poster/frame) from a finished lesson may be copied into our persistent profile-image storage and set as your **profile picture** if you do not already have one. This image remains until you change or delete it.
- Recordings and progress may also be stored **locally in your browser** (IndexedDB/localStorage) so a lesson can continue. Clearing your browser storage removes this local copy.
- Teacher/lesson media are videos we produced; they are not User Content.

**Sharing with others.** If you create a share link or friend challenge, anyone who has that link can view the associated video content. Your public profile page (at `/<shareCode>`) may display your first name, last name, native language, English level, profile picture, completed lessons, and friend-challenge link. Do not share content you consider confidential.

**No sale.** We do not sell your recordings or videos.

**Removal.** You may ask us to remove your User Content by contacting us at mrjoewalsh1@gmail.com. Content that violates our Terms may be removed by us. Because challenge clips expire automatically, they are usually deleted within 48 hours in any event.

**Copyright.** If you believe content on the Service infringes your copyright, follow the procedure in the Terms of Service.

---

## 5. Analytics, Cookies, and AI Processors

**PostHog.** We use PostHog (US Cloud) for product analytics, session replay, and error tracking. Session replay may record your on-screen interactions and the content visible on the page (for example, lesson text you type) so we can diagnose problems. Password and email input fields are masked in session replays. You can learn more and exercise choices at PostHog's website.

**Cookies and local storage.** We use cookies, localStorage, and IndexedDB to keep you signed in, remember your language and progress, and measure usage. We do not use third-party advertising cookies on the Service. You can control cookies and local storage through your browser settings, though some features may stop working.

**AI providers.** Response evaluation and the in-app English tutor use **DeepSeek** via a proxy we operate. Only the text of your response and the lesson context are transmitted.

**Geolocation.** At sign-up we query **ipapi.co** with your IP address to approximate your country, region, and city. We do not collect GPS-precise location.

**Do Not Track / Global Privacy Control.** We do not sell or share personal information for cross-context behavioral advertising, so we do not respond differently to "Do Not Track" signals. We honor Global Privacy Control (GPC) opt-out preference signals to the extent applicable.

---

## 6. When We Share Information

We disclose information only as described below:

- **Service providers / processors.** Cloudflare (hosting, R2 storage, Workers), Supabase (authentication, database, profile-image storage), PostHog (analytics), DeepSeek (AI evaluation), and ipapi.co (sign-up geolocation). They process data on our instructions.
- **People you choose.** Recipients of your share links and visitors to your public profile, as described in Section 4.
- **Legal and safety.** When required by law or to protect rights, safety, and security.
- **Business transfers.** In connection with a merger, acquisition, or sale of assets, subject to this Policy.
- **With your consent.** For any other purpose you authorize.

**We do not sell your personal information, and we do not rent or share your email address with unaffiliated third parties for their own marketing purposes without your permission.**

---

## 7. Marketing Communications

We may use the email address and other contact information you provide to send you:

- **Service messages** — account, security, and important product notices. These are not marketing and you may not be able to opt out while you have an account.
- **Marketing and promotional emails** — news, tips, offers, and updates about UFF. Where required by law (for example, in the EEA/UK), we will send these only with your consent.

**Opting out.** You can opt out of marketing at any time by clicking the "unsubscribe" link in any marketing email or by emailing mrjoewalsh1@gmail.com. Opting out does not stop service messages. We will honor opt-out requests promptly.

**No resale of contact information.** We will **not sell or rent your email address or other contact information**, and we will **not provide it to unaffiliated third parties for those third parties to send you their own marketing**, unless you have given us your express permission to do so. If we ever do so with your permission, you may withdraw that permission at any time.

---

## 8. Data Retention

| Data | Retention |
|---|---|
| Account & profile data | While your account is active, and for a limited period afterward for legal, security, and backup purposes |
| Published challenge clips & complete lesson videos | Automatically deleted after **48 hours** (R2 lifecycle) |
| Profile picture (poster-derived) | Until you change or delete it, or delete your account |
| Analytics & diagnostics | Per PostHog retention settings; typically up to 12 months |
| In-app notifications | Until you delete your account or clear them |
| Local browser data | Until you clear your browser storage |
| Legal/financial records | As long as required by applicable law |

When data is no longer needed, we delete or de-identify it.

---

## 9. Security

We use reasonable technical and organizational measures, including encryption in transit (HTTPS/TLS), access controls and row-level security on our database, hashed passwords, and authentication-gated uploads. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security. You are responsible for keeping your account credentials confidential.

---

## 10. Your Privacy Rights

Depending on where you live, you may have some or all of the following rights:

- **Access** — request a copy of the personal information we hold about you.
- **Correction** — request that we correct inaccurate information.
- **Deletion** — request that we delete your personal information.
- **Portability** — request your information in a portable format.
- **Opt out of sale/sharing** — we do not sell or share your information, so there is nothing to opt out of.
- **Restriction / objection** — object to or request restriction of certain processing.
- **Withdraw consent** — where we rely on consent, withdraw it at any time.
- **Non-discrimination** — we will not discriminate against you for exercising your rights.
- **Appeal** — where applicable, appeal our decision on a rights request.

**How to exercise your rights.** Email mrjoewalsh1@gmail.com. We may ask you to verify your identity (for example, by confirming control of your account email) before acting. We will respond within the time required by applicable law.

**California residents (CCPA/CPRA).** You have the rights above, plus the right to know the categories and specific pieces of personal information we have collected and the categories of third parties with whom we share it. We have disclosed these categories in Sections 2, 5, and 6. We do not sell or share personal information as those terms are defined by the CPRA, and we do not use or disclose sensitive personal information for purposes beyond providing the Service.

**EEA/UK residents (GDPR/UK GDPR).** You may lodge a complaint with your local supervisory authority. Our AI evaluation may involve automated processing (for example, assigning a fluency score); it does not produce legal or similarly significant effects on you. The Service is hosted in the United States and our processors may process your data there and in other countries; where required, we rely on appropriate safeguards such as standard contractual clauses.

---

## 11. Children's Privacy

The Service is not directed to children under 13 (or the minimum age required in your jurisdiction, which may be up to 16 in parts of the EEA/UK). We do not knowingly collect personal information from children below that age. If you are a parent or guardian and believe your child has provided us with personal information, contact us at mrjoewalsh1@gmail.com and we will delete it. Where local law requires verifiable parental consent for users under 16 (or another age), we will obtain it before processing.

---

## 12. International Data Transfers

We are based in the United States, and the processors we use may store and process your information in the United States and other countries. Those countries may not provide the same level of data protection as your home country. Where required, we put in place appropriate safeguards for such transfers.

---

## 13. Changes to This Policy

We may update this Privacy Policy from time to time. If we make material changes, we will notify you by email or through the Service and update the "Last updated" date above. Your continued use of the Service after the changes take effect means you accept the updated Policy.

---

## 14. Contact Us

Questions, requests, or complaints about this Policy or your personal information:

**UFF — Ultra Fast Fluency**
Joe Walsh
Boston, Massachusetts, USA
[LEGAL ENTITY ADDRESS]
Email: mrjoewalsh1@gmail.com
