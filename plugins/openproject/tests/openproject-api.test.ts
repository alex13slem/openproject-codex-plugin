import { describe, expect, test } from "bun:test";
import {
  buildBrowserUrl,
  buildWorkPackageSearchPath,
  buildWorkPackageUpdatePayload,
  compact,
  createOpenProjectApi,
  elements,
} from "../scripts/openproject-api.js";

describe("createOpenProjectApi", () => {
  test("normalizes the base URL and sends required headers", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const api = createOpenProjectApi(
      "https://tasks.example.com/",
      "test-token",
      async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify({ id: 42, subject: "Ship it" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const result = await api("/api/v3/work_packages/42");
    const headers = new Headers(requestInit?.headers);

    expect(requestUrl).toBe("https://tasks.example.com/api/v3/work_packages/42");
    expect(headers.get("Accept")).toBe("application/hal+json");
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(result).toEqual({ id: 42, subject: "Ship it" });
  });

  test("adds a JSON content type when sending a body", async () => {
    let requestInit: RequestInit | undefined;
    const api = createOpenProjectApi(
      "https://tasks.example.com",
      "test-token",
      async (_input, init) => {
        requestInit = init;
        return new Response("{}", { status: 200 });
      },
    );

    await api("/api/v3/work_packages/1", {
      method: "PATCH",
      body: JSON.stringify({ subject: "Updated" }),
    });

    expect(new Headers(requestInit?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  test("reports OpenProject status and response details", async () => {
    const api = createOpenProjectApi(
      "https://tasks.example.com",
      "test-token",
      async () =>
        new Response(JSON.stringify({ errorIdentifier: "urn:openproject-org:api:v3:errors:NotFound" }), {
          status: 404,
        }),
    );

    await expect(api("/api/v3/work_packages/404")).rejects.toThrow(
      /OpenProject HTTP 404.*NotFound/,
    );
  });
});

describe("HAL helpers", () => {
  test("extracts embedded collection elements", () => {
    expect(elements({ _embedded: { elements: [{ id: 1 }, { id: 2 }] } })).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(elements({})).toEqual([]);
  });

  test("compacts a resource to fields useful in tool results", () => {
    expect(
      compact(
        {
          id: 7,
          subject: "Review API",
          lockVersion: 3,
          _links: { self: { href: "/api/v3/work_packages/7" } },
          ignored: "large payload",
        },
        "https://tasks.example.com/",
      ),
    ).toEqual({
      id: 7,
      name: undefined,
      identifier: undefined,
      subject: "Review API",
      lockVersion: 3,
      links: { self: { href: "/api/v3/work_packages/7" } },
      url: "https://tasks.example.com/work_packages/7",
    });
  });

  test("builds browser URLs separately from HAL API links", () => {
    expect(
      buildBrowserUrl("https://tasks.example.com/", {
        id: 4,
        identifier: "store front",
        _links: { self: { href: "/api/v3/projects/4" } },
      }),
    ).toBe("https://tasks.example.com/projects/store%20front");
    expect(
      buildBrowserUrl("https://tasks.example.com/", {
        id: 42,
        _links: { self: { href: "/api/v3/work_packages/42" } },
      }),
    ).toBe("https://tasks.example.com/work_packages/42");
  });
});

describe("work package request builders", () => {
  test("encodes subject and project filters", () => {
    const path = buildWorkPackageSearchPath({
      query: "checkout flow",
      projectId: 12,
      pageSize: 25,
    });
    const url = new URL(path, "https://tasks.example.com");

    expect(url.pathname).toBe("/api/v3/work_packages");
    expect(url.searchParams.get("pageSize")).toBe("25");
    expect(JSON.parse(url.searchParams.get("filters") ?? "[]")).toEqual([
      { subject: { operator: "~", values: ["checkout flow"] } },
      { project: { operator: "=", values: ["12"] } },
    ]);
  });

  test("builds optimistic-lock update payloads", () => {
    expect(
      buildWorkPackageUpdatePayload(9, {
        subject: "Updated subject",
        description: "Progress details",
        assigneeId: null,
        priorityId: 4,
        statusId: 2,
      }),
    ).toEqual({
      lockVersion: 9,
      subject: "Updated subject",
      description: { format: "markdown", raw: "Progress details" },
      _links: {
        assignee: { href: null },
        priority: { href: "/api/v3/priorities/4" },
        status: { href: "/api/v3/statuses/2" },
      },
    });
  });
});
