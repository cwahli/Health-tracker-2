# Inbox — failing meals that loop until green

When a logged meal is wrong:

1. Download the debug export (the same `.md` you already save).
2. `node scripts/golden-from-debug.mjs ~/Downloads/debug-job_….md`
3. `npm run golden:inbox`  
   Re-run that after every code/catalog fix. **Do not re-photo the meal.**
4. When it is green: `node scripts/golden-promote.mjs <jobId>`

This is replay only (frozen `scout.json`). No Gemini. That is what replaces 10–20 manual logs.

Live-agent rotation is separate and still one meal at a time.
