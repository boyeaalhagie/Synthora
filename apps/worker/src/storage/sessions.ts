import { ResearchPreviewResult, type LlmProvider, type SessionRecord, type SessionSummary } from "@synthora/schemas";

export interface NewSession {
  owner: string;
  question: string;
  provider: LlmProvider;
  model: string;
  durationMs: number;
  result: ResearchPreviewResult;
}

/** Every method is scoped to an owner: one browser can never see or change another's sessions. */
export interface SessionStore {
  save(session: NewSession): Promise<string>;
  list(owner: string, limit?: number): Promise<SessionSummary[]>;
  get(owner: string, id: string): Promise<SessionRecord | undefined>;
  delete(owner: string, id: string): Promise<boolean>;
}

/** D1 rows are capped at 2 MB; refuse anything near that rather than fail mid-write. */
export const MAX_RESULT_BYTES = 1_800_000;

export class SessionTooLargeError extends Error {
  constructor() {
    super("This research result is too large to save.");
    this.name = "SessionTooLargeError";
  }
}

interface Row {
  id: string;
  question: string;
  provider: LlmProvider;
  model: string;
  title: string | null;
  paper_count: number;
  duration_ms: number;
  created_at: string;
}

const toSummary = (r: Row): SessionSummary => ({
  id: r.id,
  question: r.question,
  provider: r.provider,
  model: r.model,
  title: r.title,
  paperCount: r.paper_count,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

const SUMMARY_COLUMNS = "id, question, provider, model, title, paper_count, duration_ms, created_at";

export class D1SessionStore implements SessionStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async save(s: NewSession): Promise<string> {
    // Validate before writing so a malformed result can never be stored and break later reads.
    const json = JSON.stringify(ResearchPreviewResult.parse(s.result));
    if (new TextEncoder().encode(json).byteLength > MAX_RESULT_BYTES) throw new SessionTooLargeError();

    const id = this.newId();
    await this.db
      .prepare(
        `INSERT INTO research_sessions (id, owner, question, provider, model, title, paper_count, duration_ms, created_at, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        s.owner,
        s.question,
        s.provider,
        s.model,
        s.result.report.status === "written" ? s.result.report.title : null,
        s.result.papers.length,
        Math.round(s.durationMs),
        this.now().toISOString(),
        json,
      )
      .run();
    return id;
  }

  async list(owner: string, limit = 50): Promise<SessionSummary[]> {
    const { results } = await this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM research_sessions WHERE owner = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(owner, limit)
      .all<Row>();
    return results.map(toSummary);
  }

  async get(owner: string, id: string): Promise<SessionRecord | undefined> {
    const row = await this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS}, result_json FROM research_sessions WHERE owner = ? AND id = ?`)
      .bind(owner, id)
      .first<Row & { result_json: string }>();
    if (!row) return undefined;
    // Results written by an older schema that no longer parse are treated as missing, not as a server error.
    const result = ResearchPreviewResult.safeParse(JSON.parse(row.result_json));
    return result.success ? { ...toSummary(row), result: result.data } : undefined;
  }

  async delete(owner: string, id: string): Promise<boolean> {
    const outcome = await this.db.prepare("DELETE FROM research_sessions WHERE owner = ? AND id = ?").bind(owner, id).run();
    return (outcome.meta.changes ?? 0) > 0;
  }
}
