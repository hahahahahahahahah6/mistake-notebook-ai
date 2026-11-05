# Mistake Notebook AI — Next Byte Hacks V5 Devpost draft

Status: NOT submitted. Needs Claude review, then your explicit approval before any Devpost submit.
Deadline: 2026-11-07 5:00pm EST (2:00pm America/Los_Angeles).

Ready now:
- Repo: https://github.com/hahahahahahahahah6/mistake-notebook-ai
- Live demo: https://mistake-notebook-ai.onrender.com (checked 2026-11-05: home + /api/status OK, Gemini configured)
- First commit during the hackathon period: 2026-11-02

Still missing for a complete entry:
- Demo video 1–3 min (README still says "coming soon")
- At least 2–3 screenshots
- Devpost project page (software slug currently 404)

## Project name
Mistake Notebook AI

## Tagline
Snap a wrong answer, get a short solution and 3 similar practice problems from Gemini, then save them in a local notebook.

## Inspiration
After a test or homework, the hard part is not finding the right answer once. It is turning one mistake into enough practice that the same idea sticks. I wanted a phone-photo workflow that works in Chinese or English, for any subject, without forcing an account or a server-side notebook.

## What it does
1. Upload a JPG, PNG, or WebP photo of a problem you got wrong (max 5 MB).
2. Gemini transcribes it, tags subject / topics / difficulty, writes a short solution, and generates 3 similar practice problems (answers hidden until you click).
3. Edit the transcribed text if the AI misread it, then regenerate practice from your correction.
4. Save entries in My notebook in the browser (localStorage only). Filter by subject or topic. No account, no server database.
5. Clear errors for missing API key, unreadable image, rate limits, and AI failures. The app never shows mock data.

## How I built it
- Node.js HTTP server with no npm dependencies.
- lib/gemini.js: Gemini REST, structured JSON (responseJsonSchema), retry/backoff on 429/500/503, model fallback.
- lib/notebook.js: prompts, schemas, validation, normalization.
- Plain HTML/JS front end. Photos stay in memory for the request and are not stored by the app.
- Abuse caps: 10 AI calls/minute and AI_MAX_REQUESTS per server run (default 200).
- Unit tests with node --test (mocked HTTP). Hosted on Render free tier; GEMINI_API_KEY only in env vars.

## Challenges I ran into
- Early Gemini error handling had a syntax bug that broke a Render deploy; fixed immediately, later commits are live.
- Practice problems sometimes came back too similar to the original; added a difficulty rubric, lower temperature, and near-copy filtering so practice must vary in context, unknowns, or an extra step.
- Real photo quality varies; blank or unreadable images need honest failures instead of invented problems.

## Accomplishments that I'm proud of
- End-to-end local run on 2026-11-02 with real Gemini calls: 6 problem images transcribed with sensible subject/topics; blank image rejected cleanly; solutions and practice answers checked by hand with no wrong answers found in that set.
- Bilingual path works (Chinese and English problems).
- Public demo stays up on Render with secrets only in environment variables.

## What I learned
Structured output plus fallback models makes a small Node app reliable enough for a photo-in, practice-out loop. Keeping the notebook client-side keeps privacy simple for a hackathon demo.

## What's next
Handwriting-heavy photos, optional export, and a short recorded demo walkthrough for judges.

## Built with
Node.js, Gemini API, Render, vanilla HTML/CSS/JavaScript

## Try it
- Demo: https://mistake-notebook-ai.onrender.com
- Code: https://github.com/hahahahahahahahah6/mistake-notebook-ai
