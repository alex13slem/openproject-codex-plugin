import { existsSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildWorkPackageSearchPath,
  buildWorkPackageUpdatePayload,
  compact,
  compactWorkPackage,
  createOpenProjectApi,
  elements,
  type HalLink,
  workPackageWebUrl,
} from "./openproject-api.js";
import { resolveEnvFile } from "./config.js";

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

const envFile = resolveEnvFile();
if (
  (!process.env.OPENPROJECT_URL || !process.env.OPENPROJECT_API_TOKEN) &&
  existsSync(envFile)
) {
  loadEnvFile(envFile);
}

const baseUrl = process.env.OPENPROJECT_URL?.replace(/\/$/, "");
const apiToken = process.env.OPENPROJECT_API_TOKEN;
if (!baseUrl || !apiToken) {
  throw new Error(
    "OPENPROJECT_URL and OPENPROJECT_API_TOKEN are required either as " +
      `environment variables or in ${envFile}`,
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

const server = new McpServer({ name: "openproject", version: "0.3.0" });

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
    return result(projects.map(compact));
  },
);

server.registerTool(
  "search_work_packages",
  {
    description: "Search visible OpenProject work packages by subject, project, assignee, exact due date, and status.",
    inputSchema: {
      query: z.string().optional().describe("Subject text fragment"),
      projectId: z.number().int().positive().optional(),
      assigneeId: z.number().int().positive().optional(),
      assignedToMe: z.boolean().default(false),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Exact due date in YYYY-MM-DD format"),
      statusId: z.number().int().positive().optional(),
      statusCategory: z.enum(["open", "closed"]).optional(),
      pageSize: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true },
  },
  async ({
    query,
    projectId,
    assigneeId,
    assignedToMe,
    dueDate,
    statusId,
    statusCategory,
    pageSize,
  }) => {
    if (assigneeId && assignedToMe) {
      throw new Error("Use either assigneeId or assignedToMe, not both");
    }
    if (statusId && statusCategory) {
      throw new Error("Use either statusId or statusCategory, not both");
    }
    const currentUser = assignedToMe
      ? await api("/api/v3/users/me")
      : undefined;
    if (assignedToMe && !currentUser?.id) {
      throw new Error("OpenProject did not return the current user ID");
    }
    const path = buildWorkPackageSearchPath({
      query,
      projectId,
      assigneeId: currentUser?.id ?? assigneeId,
      dueDate,
      statusId,
      statusCategory,
      pageSize,
    });
    const collection = await api(path);
    return result(
      elements(collection).map((workPackage) =>
        compactWorkPackage(workPackage, baseUrl),
      ),
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
    return result({
      ...created,
      webUrl: workPackageWebUrl(baseUrl, created.id),
    });
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
    return result({
      ...updated,
      webUrl: workPackageWebUrl(baseUrl, updated.id),
    });
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
    return result({
      ...activity,
      workPackageUrl: workPackageWebUrl(baseUrl, id),
    });
  },
);

await server.connect(new StdioServerTransport());
