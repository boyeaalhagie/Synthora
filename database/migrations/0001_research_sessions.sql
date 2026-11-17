-- Completed research sessions. One row per finished run.
--
-- owner: SHA-256 (hex) of the anonymous session cookie. The cookie itself is never stored,
--        so the table cannot be used to impersonate a browser.
-- result_json: the full ResearchPreviewResult, validated against the shared schema on write and read.
-- No API keys are stored anywhere in this database.

CREATE TABLE research_sessions (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  question    TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  title       TEXT,
  paper_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  result_json TEXT NOT NULL
);

CREATE INDEX research_sessions_owner_created ON research_sessions (owner, created_at DESC);
