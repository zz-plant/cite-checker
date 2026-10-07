import { describe, expect, test } from "bun:test";
import {
  checkSource,
  checkSources,
  headersFor,
  hostRule,
  secStructuralProblem,
  type CheckOptions,
} from "../src/check.ts";

const UA = "example.org source verification you@example.org";

/** A fetch that answers by URL: a status, or an Error to throw. */
function fakeFetch(answers: Record<string, number | Error | (() => Response)>): typeof fetch {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    const answer = key === undefined ? 404 : answers[key]!;
    if (answer instanceof Error) throw answer;
    if (typeof answer === "function") return answer();
    return new Response("", { status: answer });
  }) as unknown as typeof fetch;
  (f as unknown as { calls: string[] }).calls = calls;
  return f;
}

const options = (fetchImpl: typeof fetch, extra: Partial<CheckOptions> = {}): CheckOptions => ({
  userAgent: UA,
  fetch: fetchImpl,
  timeoutMs: 1_000,
  ...extra,
});

describe("host rules", () => {
  test("matches by hostname suffix, longest wins", () => {
    const hosts = {
      "example.org": { knownBlocker: true },
      "api.example.org": { knownBlocker: false },
    };
    expect(hostRule("www.example.org", hosts)?.knownBlocker).toBe(true);
    expect(hostRule("api.example.org", hosts)?.knownBlocker).toBe(false);
    expect(hostRule("example.com", hosts)).toBeUndefined();
    expect(hostRule("notexample.org", hosts)).toBeUndefined();
  });

  test("sends SEC the declared requester and everyone else a browser identity", () => {
    expect(headersFor("https://www.sec.gov/Archives/x", { userAgent: UA })).toEqual({
      "User-Agent": UA,
    });
    const browser = headersFor("https://example.org/", { userAgent: UA });
    expect(browser["User-Agent"]).toContain("Mozilla/5.0");
    expect(browser.Accept).toContain("text/html");
  });

  test("a configured host rule overrides the headers", () => {
    const headers = headersFor("https://data.example.org/", {
      userAgent: UA,
      hosts: { "example.org": { headers: { "User-Agent": "custom" } } },
    });
    expect(headers).toEqual({ "User-Agent": "custom" });
  });
});

describe("verdicts", () => {
  const ref = { file: "x.md", url: "https://example.org/page" };

  test("an OK response is PASS", async () => {
    const r = await checkSource(ref, options(fakeFetch({ "https://example.org/page": 200 })));
    expect(r).toMatchObject({ verdict: "PASS", status: 200 });
  });

  test("a 404 is FAIL", async () => {
    const r = await checkSource(ref, options(fakeFetch({ "https://example.org/page": 404 })));
    expect(r).toMatchObject({ verdict: "FAIL", status: 404, detail: "responded 404" });
  });

  test("a refusal is UNKNOWN, never PASS", async () => {
    for (const status of [401, 403, 429, 503]) {
      const r = await checkSource(ref, options(fakeFetch({ "https://example.org/page": status })));
      expect(r.verdict).toBe("UNKNOWN");
      expect(r.detail).toContain("not a known blocker");
    }
  });

  test("a refusal from a known blocker says so", async () => {
    const r = await checkSource(
      ref,
      options(fakeFetch({ "https://example.org/page": 403 }), {
        hosts: { "example.org": { knownBlocker: true } },
      })
    );
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.detail).toContain("refuses automated clients");
  });

  test("a network error is FAIL with the message", async () => {
    const r = await checkSource(
      ref,
      options(fakeFetch({ "https://example.org/page": new Error("ECONNRESET") }))
    );
    expect(r).toMatchObject({ verdict: "FAIL", status: null, detail: "ECONNRESET" });
  });

  test("the refusal statuses are configurable", async () => {
    const r = await checkSource(
      ref,
      options(fakeFetch({ "https://example.org/page": 403 }), { refusalStatuses: [429] })
    );
    expect(r.verdict).toBe("FAIL");
  });
});

describe("resolvers", () => {
  test("a malformed SEC archive path fails without a network call", async () => {
    const bad =
      "https://www.sec.gov/Archives/edgar/data/000162828021012345/0001628280-21-012345-index.htm";
    expect(secStructuralProblem(bad)).toContain("looks like an accession number");
    expect(
      secStructuralProblem(
        "https://www.sec.gov/Archives/edgar/data/1516513/000162828021012345/x.htm"
      )
    ).toBeNull();
    expect(secStructuralProblem("https://example.org/")).toBeNull();

    const fetch = fakeFetch({});
    const r = await checkSource({ file: "x.md", url: bad }, options(fetch));
    expect(r.verdict).toBe("FAIL");
    expect((fetch as unknown as { calls: string[] }).calls).toEqual([]);
  });

  test("a DOI resolves through Crossref and carries title and authors", async () => {
    const fetch = fakeFetch({
      "https://api.crossref.org/works/10.1000/xyz": () =>
        Response.json({
          message: {
            title: ["A Paper"],
            author: [{ given: "Ada", family: "Lovelace" }, { family: "Babbage" }],
          },
        }),
    });
    const r = await checkSource(
      { file: "x.md", url: "https://doi.org/10.1000/xyz" },
      options(fetch)
    );
    expect(r).toMatchObject({ verdict: "PASS", status: 200 });
    expect(r.detail).toBe("Crossref: “A Paper” — Ada Lovelace, Babbage");
    expect((fetch as unknown as { calls: string[] }).calls).toEqual([
      "https://api.crossref.org/works/10.1000/xyz",
    ]);
  });

  test("Crossref not-found is FAIL; Crossref down is UNKNOWN", async () => {
    const ref = { file: "x.md", url: "https://doi.org/10.1000/xyz" };
    expect(
      (await checkSource(ref, options(fakeFetch({ "https://api.crossref.org": 404 })))).verdict
    ).toBe("FAIL");
    const down = await checkSource(ref, options(fakeFetch({ "https://api.crossref.org": 503 })));
    expect(down.verdict).toBe("UNKNOWN");
    expect(down.detail).toContain("resolver problem");
  });

  test("custom resolvers run first and can be the whole list", async () => {
    const fetch = fakeFetch({ "https://example.org/": 404 });
    const r = await checkSource(
      { file: "x.md", url: "https://example.org/" },
      options(fetch, {
        resolvers: [
          {
            name: "always",
            async check(ref) {
              return { ...ref, status: 200, verdict: "PASS", detail: "cached" };
            },
          },
        ],
      })
    );
    expect(r.detail).toBe("cached");
    expect((fetch as unknown as { calls: string[] }).calls).toEqual([]);
  });
});

describe("a run", () => {
  test("retries a FAIL once and reports the retry", async () => {
    let n = 0;
    const flaky = (async () => {
      n += 1;
      return new Response("", { status: n === 1 ? 500 : 200 });
    }) as unknown as typeof fetch;
    const results = await checkSources([{ file: "x.md", url: "https://example.org/" }], {
      userAgent: UA,
      fetch: flaky,
      delayMs: 0,
      retryDelayMs: 0,
    });
    expect(n).toBe(2);
    expect(results[0]).toMatchObject({ verdict: "PASS", detail: "resolved (passed on retry)" });
  });

  test("reports a source broken only when it fails twice", async () => {
    const seen: string[] = [];
    const results = await checkSources(
      [
        { file: "a.md", url: "https://example.org/gone" },
        { file: "a.md", url: "https://example.org/here" },
      ],
      {
        userAgent: UA,
        fetch: fakeFetch({ "https://example.org/gone": 404, "https://example.org/here": 200 }),
        delayMs: 0,
        retryDelayMs: 0,
        onResult: (r) => seen.push(`${r.url} ${r.verdict}`),
      }
    );
    expect(results.map((r) => r.verdict)).toEqual(["FAIL", "PASS"]);
    expect(seen).toEqual(["https://example.org/gone FAIL", "https://example.org/here PASS"]);
  });
});
