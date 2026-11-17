import { z } from "zod";
import { fetchWithRetry, UpstreamError, type FetchWithRetryDeps } from "../lib/http.js";
import { stripMarkup } from "../lib/text.js";

const WORKS_URL = "https://api.crossref.org/works/";

export interface CrossrefConfig {
  /**
   * Operator contact address for Crossref's "polite pool" (better service).
   * Never a user's address. Omitted when not configured.
   */
  mailto?: string | undefined;
}

export interface CrossrefWork {
  title?: string;
  year?: number;
}

const DateParts = z.object({ "date-parts": z.array(z.array(z.number().nullable())).min(1) });

const WorkResponse = z.object({
  message: z.object({
    title: z.array(z.string()).optional(),
    issued: DateParts.optional(),
    published: DateParts.optional(),
  }),
});

export class CrossrefClient {
  constructor(
    private readonly config: CrossrefConfig,
    private readonly deps: FetchWithRetryDeps,
  ) {}

  /** Looks up a DOI. Resolves `undefined` when Crossref has no record (404). */
  async work(doi: string): Promise<CrossrefWork | undefined> {
    const url = new URL(WORKS_URL + encodeURIComponent(doi));
    const userAgent = this.config.mailto ? `Synthora/0.1 (mailto:${this.config.mailto})` : "Synthora/0.1";

    let response: Response;
    try {
      response = await fetchWithRetry(url, { headers: { accept: "application/json", "user-agent": userAgent } }, this.deps);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) return undefined;
      throw err;
    }

    const parsed = WorkResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new UpstreamError("Crossref returned an unexpected response shape");

    const { title, issued, published } = parsed.data.message;
    const year = (issued ?? published)?.["date-parts"][0]?.[0] ?? undefined;
    const cleanTitle = title?.[0] ? stripMarkup(title[0]) : undefined;
    return { ...(cleanTitle && { title: cleanTitle }), ...(year != null && { year }) };
  }
}
