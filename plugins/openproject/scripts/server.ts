import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildWorkPackageSearchPath,
  buildWorkPackageUpdatePayload,
  compact,
  createOpenProjectApi,
  elements,
  type HalLink,
} from "./openproject-api.js";

const envFile =
  process.env.OPENPROJECT_ENV_FILE ??
  join(homedir(), ".config", "codex", "openproject.env");

function loadEnvFile(path: string): void {
  const source = readFileSync(path, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(envFile);

const baseUrl = process.env.OPENPROJECT_URL?.replace(/\/$/, "");
const apiToken = process.env.OPENPROJECT_API_TOKEN;
if (!baseUrl || !apiToken) {
  throw new Error(
    `OPENPROJECT_URL and OPENPROJECT_API_TOKEN are required in ${envFile}`,
  );
}
const api = createOpenProjectApi(baseUrl, apiToken);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

async function resolveProjectType(
  projectId: number,
  requestedTypeId?: number,
): Promise<number> {
  if (requestedTypeId) return requestedTypeId;
  const collection = await api(`/api/v3/projects/${projectId}/types`);
  const types = elements(collection);
  const task = types.find(
    (type) => String(type.name ?? "").toLowerCase() === "task",
  );
  const selected = task ?? types[0];
  if (!selected?.id) {
    throw new Error(`No work package types are available for project ${projectId}`);
  }
  return selected.id;
}

const server = new McpServer({ name: "openproject", version: "0.1.0" });

server.registerTool(
  "list_projects",
  {
    description: "List visible OpenProject projects, optionally filtering locally by name or identifier.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive name or identifier fragment"),
      pageSize: z.number().int().min(1).max(200).default(100),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, pageSize }) => {
    const collection = await api(`/api/v3/projects?pageSize=${pageSize}`);
    const normalized = query?.toLowerCase();
    const projects = elements(collection).filter((project) => {
      if (!normalized) return true;
      return [project.name, project.identifier].some((value) =>
        String(value ?? "").toLowerCase().includes(normalized),
      );
    });
    return result(projects.map((project) => compact(project, baseUrl)));
  },
);

server.registerTool(
  "search_work_packages",
  {
    description: "Search visible OpenProject work packages by subject and optional project ID.",
    inputSchema: {
      query: z.string().optional().describe("Subject text fragment"),
      projectId: z.number().int().positive().optional(),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, projectId, pageSize }) => {
    const path = buildWorkPackageSearchPath({ query, projectId, pageSize });
    const collection = await api(path);
    return result(
      elements(collection).map((workPackage) => compact(workPackage, baseUrl)),
    );
  },
);

server.registerTool(
  "get_work_package",
  {
    description: "Get a complete OpenProject work package by numeric ID.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => result(await api(`/api/v3/work_packages/${id}`)),
);

server.registerTool(
  "create_work_package",
  {
    description: "Create an OpenProject work package in a project.",
    inputSchema: {
      projectId: z.number().int().positive(),
      subject: z.string().min(1),
      description: z.string().optional(),
      typeId: z.number().int().positive().optional(),
      assigneeId: z.number().int().positive().optional(),
      priorityId: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ projectId, subject, description, typeId, assigneeId, priorityId }) => {
    const resolvedTypeId = await resolveProjectType(projectId, typeId);
    const links: Record<string, HalLink> = {
      type: { href: `/api/v3/types/${resolvedTypeId}` },
    };
    if (assigneeId) links.assignee = { href: `/api/v3/users/${assigneeId}` };
    if (priorityId) links.priority = { href: `/api/v3/priorities/${priorityId}` };
    const created = await api(`/api/v3/projects/${projectId}/work_packages`, {
      method: "POST",
      body: JSON.stringify({
        subject,
        ...(description
          ? { description: { format: "markdown", raw: description } }
          : {}),
        _links: links,
      }),
    });
    return result(created);
  },
);

server.registerTool(
  "update_work_package",
  {
    description: "Update selected fields on an existing OpenProject work package.",
    inputSchema: {
      id: z.number().int().positive(),
      subject: z.string().min(1).optional(),
      description: z.string().optional(),
      assigneeId: z.number().int().positive().nullable().optional(),
      priorityId: z.number().int().positive().optional(),
      statusId: z.number().int().positive().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ id, subject, description, assigneeId, priorityId, statusId }) => {
    const current = await api(`/api/v3/work_packages/${id}`);
    const body = buildWorkPackageUpdatePayload(current.lockVersion, {
      subject,
      description,
      assigneeId,
      priorityId,
      statusId,
    });
    const updated = await api(`/api/v3/work_packages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return result(updated);
  },
);

server.registerTool(
  "add_work_package_comment",
  {
    description: "Add a markdown comment to an OpenProject work package.",
    inputSchema: {
      id: z.number().int().positive(),
      comment: z.string().min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ id, comment }) => {
    const activity = await api(`/api/v3/work_packages/${id}/activities`, {
      method: "POST",
      body: JSON.stringify({ comment: { format: "markdown", raw: comment } }),
    });
    return result(activity);
  },
);

await server.connect(new StdioServerTransport());
