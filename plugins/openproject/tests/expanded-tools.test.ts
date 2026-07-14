import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertAllowedUploadPath,
  registerExpandedTools,
} from "../scripts/expanded-tools.js";
import type { OpenProjectApi } from "../scripts/openproject-api.js";

const READ_ONLY = [
  "get_project",
  "count_projects",
  "count_work_packages",
  "list_work_package_activities",
  "list_work_package_relations",
  "get_work_package_relation",
  "get_current_user",
  "list_users",
  "get_user",
  "list_available_assignees",
  "list_work_package_types",
  "list_work_package_statuses",
  "list_work_package_priorities",
  "list_project_versions",
  "list_work_package_watchers",
  "list_notifications",
  "get_notification",
  "list_boards",
  "get_board",
  "list_board_lanes",
  "get_openproject_api",
];

const DESTRUCTIVE = [
  "delete_project",
  "delete_work_package",
  "delete_work_package_relation",
  "delete_work_package_attachment",
  "remove_work_package_watcher",
];

function makeServer(api?: OpenProjectApi) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerExpandedTools(
    server,
    api ?? ((async () => ({})) as unknown as OpenProjectApi),
    "https://tasks.example.com",
  );
  return server;
}

function registered(server: McpServer) {
  return (server as unknown as {
    _registeredTools: Record<
      string,
      {
        annotations?: Record<string, boolean>;
        handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
      }
    >;
  })._registeredTools;
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
) {
  return registered(server)[name]!.handler(args, {});
}

describe("expanded OpenProject tools", () => {
  test("registers the complete expanded tool set with safety annotations", () => {
    const tools = registered(makeServer());

    expect(Object.keys(tools)).toHaveLength(33);
    for (const name of READ_ONLY) {
      expect(tools[name]?.annotations?.readOnlyHint).toBe(true);
    }
    for (const name of DESTRUCTIVE) {
      expect(tools[name]?.annotations?.destructiveHint).toBe(true);
    }
  });

  test("creates relations with both work-package links", async () => {
    let path = "";
    let init: RequestInit | undefined;
    const api = (async (requestedPath: string, requestedInit?: RequestInit) => {
      path = requestedPath;
      init = requestedInit;
      return { id: 9, type: "blocks" };
    }) as OpenProjectApi;
    const server = makeServer(api);

    await callTool(server, "create_work_package_relation", {
      fromId: 2,
      toId: 3,
      type: "blocks",
    });

    expect(path).toBe("/api/v3/relations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "blocks",
      _links: {
        from: { href: "/api/v3/work_packages/2" },
        to: { href: "/api/v3/work_packages/3" },
      },
    });
  });

  test("adds a watcher using the OpenProject link payload", async () => {
    let body: unknown;
    const api = (async (_path: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return { id: 7, name: "Alex" };
    }) as OpenProjectApi;
    const server = makeServer(api);

    await callTool(server, "add_work_package_watcher", {
      workPackageId: 4,
      userId: 7,
    });

    expect(body).toEqual({ user: { href: "/api/v3/users/7" } });
  });

  test("rejects passthrough requests outside API v3", async () => {
    const server = makeServer();

    await expect(
      callTool(server, "get_openproject_api", {
        path: "//evil.example/api/v3/users",
      }),
    ).rejects.toThrow(/relative|under \/api\/v3/);
  });

  test("allows uploads only from configured roots and resolves symlinks", () => {
    const allowed = mkdtempSync(join(tmpdir(), "openproject-allowed-"));
    const outside = mkdtempSync(join(tmpdir(), "openproject-outside-"));
    const allowedFile = join(allowed, "notes.md");
    const outsideFile = join(outside, "secret.txt");
    const linkedOutsideFile = join(allowed, "linked-secret.txt");
    writeFileSync(allowedFile, "notes");
    writeFileSync(outsideFile, "secret");
    symlinkSync(outsideFile, linkedOutsideFile);

    try {
      expect(assertAllowedUploadPath(allowedFile, allowed)).toBe(allowedFile);
      expect(() => assertAllowedUploadPath(outsideFile, allowed)).toThrow(
        /outside OPENPROJECT_ALLOWED_UPLOAD_DIRS/,
      );
      expect(() => assertAllowedUploadPath(linkedOutsideFile, allowed)).toThrow(
        /outside OPENPROJECT_ALLOWED_UPLOAD_DIRS/,
      );
    } finally {
      rmSync(allowed, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
