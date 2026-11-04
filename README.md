# Reconnect HQ

An outreach workbench for your LinkedIn network. Import your LinkedIn data export, then work through your connections: rate each relationship, set a status, snooze people for later, take notes, and draft messages. It runs entirely in your browser, with no account, no server, and no tracking.

Created by **Jenna Hasenkampf**.

## What it does

- **Imports your LinkedIn export in the browser.** Drop the export `.zip`, or `Connections.csv` plus `messages.csv`. Nothing is uploaded.
- **Ranks people by LinkedIn message history.** Ranking uses recency and thread depth. A snippet of the last message appears on each card.
- **Lets you rate relationship strength** from ★ (name recognition) to ★★★ (would pick up the phone).
- **Tracks a status for each person:** To reach out, Sent, Replied, Meeting booked, Skip, or Snooze for 7, 14 or 30 days. Snoozed people stay hidden until the date passes.
- **Combines filters.** "Show only" filters must all match. Status checkboxes match any one you check.
- **Supports custom tags.** It ships with a **Product** tag that auto-detects PM, product and CPO titles. You can add your own tags and auto-tag by title keywords. Any card can be tagged or untagged by hand.
- **Merges re-imports.** Import a newer export any time. Your ratings, statuses and notes are kept, new connections are marked, and **job changes are flagged** with the previous role shown.
- **Has a follow-up view.** It shows people you messaged more than *N* days ago who haven't been updated since.
- **Creates calendar reminders.** One click downloads an `.ics` event for a follow-up or snooze date. It works with Google Calendar, Outlook and Apple Calendar.
- **Fills draft messages from editable templates** with `{first}`, `{company}`, `{position}` and `{name}`.
- **Has keyboard triage.** `j`/`k` to move, `1`–`3` to rate, `r e y m x` for statuses, `z` to snooze, `n` for a note, `?` for the full list.
- **Notes and role edits.** Add notes on any card, and add a person's other roles. LinkedIn's export only includes their primary role.
- **Backup, restore and CSV export** let you move your progress between browsers or open it in a spreadsheet.

## Use it

**Hosted:** <https://jbunnystruggle.github.io/reconnect-hq/> (after GitHub Pages is turned on — see Development). Every push to `main` is tested and deployed automatically.

**Locally:** ES modules don't load from `file://`, so serve the folder:

```sh
git clone https://github.com/jbunnystruggle/reconnect-hq.git
cd reconnect-hq
python3 -m http.server 8000     # or: npm start
# open http://localhost:8000
```

Click **Try with sample data** to explore with fictional people before using your own.

## Getting your LinkedIn export

1. On LinkedIn, go to **Settings & Privacy → Data privacy → Get a copy of your data**.
2. Select **Connections** and **Messages** (or the full archive) and request the archive.
3. LinkedIn emails a download link, usually within minutes for connections and messages.
4. Drop the downloaded `.zip` onto Reconnect HQ.

Notes:
- LinkedIn's export lists only each person's primary role, and email addresses only when the person allows it.
- Message history only covers LinkedIn. Relationships you keep up by email, text or in person won't show there, which is what star ratings and notes are for.
- Rows for deleted or hidden accounts (blank name and URL) are skipped.

## Privacy

- All data lives in your browser's `localStorage` on your device. Clearing site data deletes it, so use **Back up** to keep a copy.
- The page makes no network requests beyond loading its own files. The zip reader ([JSZip](https://stuk.github.io/jszip/)) is bundled in `js/vendor/`.
- Backups and CSV exports contain your contacts and notes. Store them privately.
- `.gitignore` blocks real exports and backups from being committed by accident.

## Development

No build step: plain HTML, CSS and JavaScript modules.

```
index.html          page shell
css/styles.css      styles (light + dark)
js/app.js           UI, filters, keyboard, settings, import flow
js/linkedin.js      export parsing, scoring, re-import merge (pure, tested)
js/csv.js           CSV parse/write (pure, tested)
js/ics.js           calendar reminder files (pure, tested)
js/store.js         localStorage persistence and defaults
js/vendor/          JSZip 3.10.1 (MIT/GPLv3 dual license)
sample/             fictional demo data in LinkedIn's format
tools/make_sample.py  regenerates the demo data
tests/              node:test suite
```

```sh
npm test        # runs the test suite (Node 18+)
npm run sample  # regenerates sample/ from tools/make_sample.py
```

GitHub Actions runs the tests on every push and pull request, and deploys to GitHub Pages from `main`. To turn on Pages for a fork, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## License

[MIT](LICENSE). JSZip is included under its MIT license; see `js/vendor/JSZIP-LICENSE.md`.
