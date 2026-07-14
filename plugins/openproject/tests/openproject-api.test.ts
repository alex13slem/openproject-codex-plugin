import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildWorkPackageSearchPath,
  buildWorkPackageUpdatePayload,
  compact,
  compactAttachment,
  compactWorkPackage,
  createOpenProjectApi,
  elements,
  isTextAttachment,
  workPackageWebUrl,
} from "../scripts/openproject-api.js";
import { resolveEnvFile } from "../scripts/config.js";

describe("configuration", () => {
  test("uses the cross-platform Codex directory for new installations", () => {
    const home = join("home", "test");
    expect(resolveEnvFile(undefined, home, () => false)).toBe(
      join(home, ".codex", "openproject.env"),
    );
  });

  test("keeps an existing legacy environment file working", () => {
    const home = join("home", "test");
    const legacyPath = join(home, ".config", "codex", "openproject.env");
    expect(
      resolveEnvFile(
        undefined,
        home,
        (path) => path === legacyPath,
      ),
    ).toBe(legacyPath);
  });

  test("prefers an explicitly configured environment file", () => {
    const explicitPath = join(process.cwd(), "secure", "openproject.env");
    expect(resolveEnvFile(explicitPath, join("home", "test"), () => false)).toBe(
      explicitPath,
    );
  });
});

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

  test("downloads authenticated attachment content with a size limit", async () => {
    let requestInit: RequestInit | undefined;
    const api = createOpenProjectApi(
      "https://tasks.example.com",
      "test-token",
      async (_input, init) => {
        requestInit = init;
        return new Response("attachment body", {
          status: 200,
          headers: { "Content-Type": "text/markdown", "Content-Length": "15" },
        });
      },
    );

    const downloaded = await api.download("/api/v3/attachments/4/content", 100);
    const headers = new Headers(requestInit?.headers);

    expect(headers.get("Accept")).toBe("*/*");
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(downloaded.contentType).toBe("text/markdown");
    expect(new TextDecoder().decode(downloaded.bytes)).toBe("attachment body");
  });

  test("rejects attachment downloads above the declared size limit", async () => {
    const api = createOpenProjectApi(
      "https://tasks.example.com",
      "test-token",
      async () =>
        new Response("too large", {
          status: 200,
          headers: { "Content-Length": "1000" },
        }),
    );

    await expect(api.download("/api/v3/attachments/4/content", 100)).rejects.toThrow(
      /1000 bytes.*100 bytes/,
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
      compact({
        id: 7,
        subject: "Review API",
        lockVersion: 3,
        _links: { self: { href: "/api/v3/work_packages/7" } },
        ignored: "large payload",
      }),
    ).toEqual({
      id: 7,
      name: undefined,
      identifier: undefined,
      subject: "Review API",
      lockVersion: 3,
      links: { self: { href: "/api/v3/work_packages/7" } },
    });
  });

  test("compacts a work package without returning every HAL action link", () => {
    expect(
      compactWorkPackage(
        {
          id: 8,
          subject: "Due today",
          startDate: "2026-07-12",
          dueDate: "2026-07-13",
          percentageDone: 25,
          _links: {
            project: { href: "/api/v3/projects/2", title: "ERP" },
            status: { href: "/api/v3/statuses/7", title: "In progress" },
            assignee: { href: "/api/v3/users/4", title: "Alex" },
            update: { href: "/api/v3/work_packages/8/form" },
          },
        },
        "https://tasks.example.com/",
      ),
    ).toEqual({
      id: 8,
      subject: "Due today",
      url: "https://tasks.example.com/work_packages/8",
      startDate: "2026-07-12",
      dueDate: "2026-07-13",
      percentageDone: 25,
      project: { href: "/api/v3/projects/2", title: "ERP" },
      type: null,
      status: { href: "/api/v3/statuses/7", title: "In progress" },
      priority: null,
      assignee: { href: "/api/v3/users/4", title: "Alex" },
      self: null,
    });
  });

  test("builds clickable work package URLs", () => {
    expect(workPackageWebUrl("https://tasks.example.com/", 42)).toBe(
      "https://tasks.example.com/work_packages/42",
    );
    expect(workPackageWebUrl("https://tasks.example.com", undefined)).toBeUndefined();
  });

  test("compacts attachment metadata and detects readable text files", () => {
    expect(
      compactAttachment({
        id: 3,
        fileName: "accounting.md",
        fileSize: 120,
        contentType: "application/octet-stream",
        status: "uploaded",
        _links: { author: { href: "/api/v3/users/2", title: "Alex" } },
      }),
    ).toEqual({
      id: 3,
      fileName: "accounting.md",
      fileSize: 120,
      contentType: "application/octet-stream",
      status: "uploaded",
      author: { href: "/api/v3/users/2", title: "Alex" },
      downloadLocation: null,
    });
    expect(isTextAttachment("accounting.md", "application/octet-stream")).toBe(true);
    expect(isTextAttachment("report.pdf", "application/pdf")).toBe(false);
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

  test("encodes assignee, due date, and open status filters", () => {
    const path = buildWorkPackageSearchPath({
      assigneeId: 7,
      dueDate: "2026-07-13",
      statusCategory: "open",
      pageSize: 50,
    });
    const url = new URL(path, "https://tasks.example.com");

    expect(JSON.parse(url.searchParams.get("filters") ?? "[]")).toEqual([
      { assignee: { operator: "=", values: ["7"] } },
      { dueDate: { operator: "=d", values: ["2026-07-13"] } },
      { status: { operator: "o", values: [] } },
    ]);
  });

  test("encodes an exact status ID", () => {
    const path = buildWorkPackageSearchPath({
      statusId: 4,
      pageSize: 50,
    });
    const url = new URL(path, "https://tasks.example.com");

    expect(JSON.parse(url.searchParams.get("filters") ?? "[]")).toEqual([
      { status: { operator: "=", values: ["4"] } },
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
