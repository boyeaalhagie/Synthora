import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Paper } from "@synthora/schemas";
import type { FetchFn } from "../src/lib/http.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export interface RecordedCall {
  url: URL;
  init: RequestInit | undefined;
}

/** A fetch stub that replays scripted responses in order and records each call. */
export function scriptedFetch(responses: Array<Response | Error | (() => Response)>): {
  fetch: FetchFn;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: FetchFn = async (input, init) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input), init });
    const next = responses.shift();
    if (next === undefined) throw new Error("scriptedFetch: no more responses");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  return { fetch, calls };
}

export const noSleep = async (): Promise<void> => {};

export function paper(overrides: Partial<Paper> & Pick<Paper, "id">): Paper {
  return {
    title: "A study",
    authors: [],
    publicationTypes: [],
    sources: ["pubmed"],
    ...overrides,
  };
}
