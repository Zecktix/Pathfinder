# Pathfinder

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A self-hosted, AI-assisted job board that runs on your own computer. It downloads real job postings from public company job boards, understands where each job can actually be worked from, and scores how well each one fits **your** resume with an explainable, experience-first percentage.

It is built for people searching internationally: it detects visa sponsorship, relocation help, language requirements and remote restrictions, and it never assumes that "remote" means "remote from anywhere".

- **One file, zero dependencies.** The whole app is `pathfinder.js` and needs only [Node.js](https://nodejs.org) 18 or newer. No npm install, no API keys, no accounts with anyone.
- **Private by default.** Your resume, account and applications stay in a folder on your machine. The server listens on `127.0.0.1` only.
- **Optional local AI.** If [Ollama](https://ollama.com) is running, you get plain-English fit explanations, job summaries, resume tailoring and cover letters. Everything works without it.

## Features

### Search and filters
- Natural-language queries: `Marketing jobs in Spain`, `Remote software engineering jobs`, `English-speaking jobs in Japan`.
- Relevance ranking that requires real matches in the title, category or an exact skill, so one stray keyword does not pull in unrelated jobs.
- Sort by relevance, newest, salary (converted to USD) or job fit.
- Filters: Remote only (prominent toggle), Hybrid, On-site, country, city, category, experience level (internship, entry, junior, mid, senior, lead), job type, salary, date posted, English-speaking, visa sponsorship, relocation assistance, international applicants welcome, language requirement, and minimum fit. All filters combine and show as removable chips.
- Infinite scroll, loading states, error handling with retry, and "remove this filter" suggestions when nothing matches.
- Saved jobs, recently viewed jobs, an application tracker, and a mobile layout.

### Remote and international intelligence
Each posting is analysed and labelled:

| Label | Meaning |
|---|---|
| Remote – Worldwide | The posting says you can work from anywhere |
| Remote – Country Restricted (X) | Remote, but only for people in the listed country or region |
| Remote – Location Unspecified | Remote, but the posting does not say where. Hidden in foreign-country searches unless you opt in |
| Hybrid / On-site | Taken from the board's own workplace type when available |
| Visa Sponsorship | The posting offers it (negations such as "we do not sponsor visas" are detected) |
| Relocation Assistance | The posting offers it |
| English Speaking / English OK | English is the working language or the job is in an English-speaking country / posted in English with no other language required |
| Spanish, Japanese, ... required or preferred | Language requirements, separated into required and preferred |
| International Applicants Welcome | Visa or relocation offered, worldwide remote, or an explicit statement |

An **eligibility check** compares each job with the country you live in and tells you if it is open to you, needs checking, or excludes you (for example "Remote only for people in Germany"). The job page quotes the exact sentence from the posting that each label is based on.

### Job fit percentage
The score is deterministic and explainable, not an AI guess. Components:

| Component | Weight | What is measured |
|---|---|---|
| Relevant experience | 40 | Years in the same or related fields versus the years the job asks for. Part-time work and internships count less, overlapping jobs are not double counted, and projects and coursework add a little. |
| Skills match | 25 | Required skills count most, preferred ones little. Related skills (for example Splunk for SIEM) earn partial credit. |
| Role and responsibilities | 15 | Field overlap, title similarity, keyword overlap with your resume |
| Education | 10 | Required degree level, softened by "or equivalent experience" |
| Language | 5 | Required languages versus your listed levels |
| Certifications and other | 5 | Required or preferred certifications, clearance, new-graduate programs |

Experience can **cap** the total. If a job wants about six years and you have well under half of that, the score cannot exceed the "Potential Match" range no matter how many skills match. A required language far above your level caps it too. Labels: **Excellent** 80+, **Good** 65-79, **Potential** 45-64, **Low** below 45.

Every job page shows the per-component breakdown, strengths, gaps, missing required skills and concrete advice.

## Quick start

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Download or clone this repository.
3. Start the app:
   - **Windows:** double-click `start-pathfinder.bat`
   - **macOS / Linux:** `node pathfinder.js`
4. Open <http://localhost:3000>, create an account, and upload your resume on the **Profile** tab.

The first start downloads jobs, which can take a minute or two. After that, jobs refresh every 30 minutes while the app is running.

### Optional: local AI with Ollama

```bash
ollama pull llama3.2
```

Leave Ollama running and Pathfinder detects it automatically. The AI explains and drafts only. It never changes the fit score.

## Configuration

### Which companies and sources are downloaded
Create a file named `boards.json` next to `pathfinder.js`. If there is no `boards.json`, the built-in list at the top of `pathfinder.js` is used.

```json
{
  "greenhouse": ["stripe", "airbnb"],
  "lever": ["spotify"],
  "ashby": ["ramp", "openai"],
  "recruitee": [],
  "workable": [],
  "aggregators": ["remotive", "remoteok", "arbeitnow", "himalayas"],
  "try": ["some-company-name"]
}
```

- Use the company's slug from its careers URL, for example `boards.greenhouse.io/<slug>`.
- Names under `"try"` are checked on Greenhouse, Lever (US and EU) and Ashby. Misses are skipped quietly and remembered for 14 days.
- `aggregators` are queried at most once every 6 hours each. Remove a name to turn that source off.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to listen on. Keep the default unless you understand the risk of exposing your data |
| `REFRESH_MINUTES` | `30` | How often to re-download jobs. `0` disables automatic refresh |
| `OFFLINE` | unset | Set to `1` to never contact job boards (uses saved jobs only) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama is running |
| `OLLAMA_MODEL` | `llama3.2` | Model for AI features |
| `OLLAMA_CTX` | `8192` | Context window |
| `OLLAMA_TIMEOUT_SECONDS` | `300` | Per-request timeout |

Example (Windows cmd): `set PORT=3001 && node pathfinder.js`

## Where your data lives

Everything is stored in a `pathfinder-data/` folder next to `pathfinder.js`:

| File | Contents |
|---|---|
| `jobs.json` | Downloaded jobs plus the facts derived from them |
| `users.json` | Accounts (scrypt-hashed passwords), session tokens, resumes, saved and applied jobs |
| `fx.json` | Exchange rates for salary comparison (refreshed daily when online) |
| `boards-gone.json`, `last-fetch.json` | Which boards were not found, and when aggregators were last queried |

**Never commit or share `pathfinder-data/`.** It contains your resume and login tokens. The included `.gitignore` excludes it.

## How the code is organised

`pathfinder.js` is a single file with clearly marked sections (search for `=====`):

| Section | Responsibility |
|---|---|
| `COMPANIES` | Default sources |
| `M.adapters` | One adapter per job source |
| `M.resume` | PDF, DOCX and image resume reading |
| `M.geo` | Location text to countries, cities and remote scope |
| `M.enrich` | Facts derived from each posting: work mode, remote scope, visa, relocation, languages, skills, level, years required |
| `M.profile` | Resume text to a structured profile |
| `M.fit` | Fit score and eligibility check |
| `M.search` | Query understanding, filters, ranking, facets, recommendations |
| `M.ai` | Ollama integration |
| `M.client` | The browser UI, written as a normal function and inlined into the page |
| server | HTTP API, accounts, refresh |

To add a job source, write an adapter that returns jobs in the same shape as the existing ones and register it in `ADAPTERS` (boards listed by name) or `AGGREGATORS` (one request, many companies).

## Limitations

- Visa, relocation, language and remote-scope labels come from the posting text. "Not mentioned" does not mean "not available". Ask the employer before assuming.
- Many boards just say "Remote" without saying where. These appear as **Location Unspecified**.
- Skill, level and category detection is rule-based and will sometimes be wrong. The fit score is a guide, not a prediction.
- Visa background notes for Spain and Japan are general information, not legal advice. Check official government sources.
- Only legitimate postings from public job-board APIs are shown, each linking to its original application page. Nothing is fabricated.
- Aggregator sources have their own terms. Pathfinder links every job back to its source and polls them at most every 6 hours. If you add more sources, follow their terms.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Node.js is not installed" | Install it from <https://nodejs.org> and rerun |
| Port already in use | Close the other program or set `PORT` to another number |
| No jobs after the first start | Wait for the first download to finish, or click **Retry download**. Check your internet connection |
| AI buttons are greyed out | Start Ollama and run `ollama pull llama3.2` |
| Resume upload fails | The first upload installs reading libraries and needs internet. Scanned PDFs need [poppler](https://poppler.freedesktop.org) for OCR. Pasting resume text always works |
| A company's jobs are missing | Check the slug spelling in `boards.json` |

## Contributing

Issues and pull requests are welcome. Please keep it a single file with no dependencies, never add fabricated job listings, never commit `pathfinder-data/`, and run `node --check pathfinder.js` before opening a pull request.

## License

MIT. See [LICENSE](LICENSE).

## Author

Built by Riley Maynard ([@Zecktix](https://github.com/Zecktix)). Questions or feedback: ril3ymaynard@gmail.com.