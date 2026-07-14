import { existsSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildWorkPackageSearchPath,
  buildCollectionPath,
  collectionResult,
  buildWorkPackageUpdatePayload,
  compact,
  compactAttachment,
  compactWorkPackage,
  createOpenProjectApi,
  elements,
  isTextAttachment,
  type HalLink,
  type OpenProjectFilter,
  workPackageWebUrl,
} from "./openproject-api.js";
import { resolveEnvFile } from "./config.js";
import { registerExpandedTools } from "./expanded-tools.js";

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
  (!(process.env.OPENPROJECT_URL ?? process.env.OPENPROJECT_BASE_URL) ||
    !(process.env.OPENPROJECT_API_TOKEN ?? process.env.OPENPROJECT_API_KEY)) &&
  existsSync(envFile)
) {
  loadEnvFile(envFile);
}

const baseUrl = (
  process.env.OPENPROJECT_URL ?? process.env.OPENPROJECT_BASE_URL
)?.replace(/\/$/, "");
const apiToken =
  process.env.OPENPROJECT_API_TOKEN ?? process.env.OPENPROJECT_API_KEY;
if (!baseUrl || !apiToken) {
  throw new Error(
    "OPENPROJECT_URL and OPENPROJECT_API_TOKEN are required either as " +
      `environment variables or in ${envFile}. OPENPROJECT_BASE_URL and ` +
      "OPENPROJECT_API_KEY are accepted as compatibility aliases.",
  );
}
const timeoutMs = Number(process.env.OPENPROJECT_TIMEOUT_MS ?? "30000");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
  throw new Error("OPENPROJECT_TIMEOUT_MS must be between 1000 and 300000");
}
const defaultPageSize = Number(process.env.OPENPROJECT_PAGE_SIZE ?? "25");
if (
  !Number.isInteger(defaultPageSize) ||
  defaultPageSize < 1 ||
  defaultPageSize > 100
) {
  throw new Error("OPENPROJECT_PAGE_SIZE must be between 1 and 100");
}
const authMode = process.env.OPENPROJECT_AUTH_MODE ?? "basic";
if (authMode !== "basic" && authMode !== "bearer") {
  throw new Error("OPENPROJECT_AUTH_MODE must be basic or bearer");
}
const api = createOpenProjectApi(
  baseUrl,
  apiToken,
  fetch,
  timeoutMs,
  authMode,
);

const filterSchema = z.array(
  z.object({
    field: z.string().min(1).describe("Native OpenProject filter field name"),
    operator: z.string().min(1).describe("Native operator such as =, !, ~, o, c, *, or !*"),
    values: z.array(z.string()).nullable().describe("String values, or null for operators that take no values"),
  }),
).optional();

const sortSchema = z.array(
  z.tuple([z.string().min(1), z.enum(["asc", "desc"])]),
).optional();

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

const server = new McpServer({ name: "openproject", version: "0.5.0" });

server.registerTool(
  "list_projects",
  {
    description:
      "List visible projects with native filters, sorting, and pagination. Use this to discover project IDs or identifiers; use get_project when the target is already known and count_projects when only a total is needed.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive name or identifier fragment; combined with filters using AND"),
      filters: filterSchema,
      sortBy: sortSchema,
      offset: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(100).default(defaultPageSize),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, filters, sortBy, offset, pageSize }) => {
    const combined = [...(filters ?? [])] as OpenProjectFilter[];
    if (query) {
      combined.push({
        field: "name_and_identifier",
        operator: "~",
        values: [query],
      });
    }
    const response = await api(
      buildCollectionPath("/api/v3/projects", {
        filters: combined,
        sortBy,
        offset,
        pageSize,
      }),
    );
    return result({
      ...collectionResult(response),
      elements: elements(response).map(compact),
    });
  },
);

server.registerTool(
  "search_work_packages",
  {
    description:
      "Search visible work packages with focused fields plus optional native filters, sorting, and pagination. Use this for discovery or lists; use get_work_package for the complete resource once an ID is known and count_work_packages for totals only.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive subject text fragment"),
      projectId: z.number().int().positive().optional(),
      assigneeId: z.number().int().positive().optional(),
      assignedToMe: z.boolean().default(false).describe("Resolve the current user and filter by that assignee; cannot be combined with assigneeId"),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Exact due date in YYYY-MM-DD format"),
      statusId: z.number().int().positive().optional(),
      statusCategory: z.enum(["open", "closed"]).optional().describe("Broad status group; cannot be combined with statusId"),
      filters: filterSchema,
      sortBy: sortSchema,
      offset: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(100).default(defaultPageSize),
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
    filters,
    sortBy,
    offset,
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
      filters: filters as OpenProjectFilter[] | undefined,
      sortBy,
      offset,
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
    description:
      "Get the complete HAL+JSON representation of one work package by numeric ID. Use after search when full descriptions, links, custom fields, or lockVersion are required; this performs no write.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => result(await api(`/api/v3/work_packages/${id}`)),
);

server.registerTool(
  "list_work_package_attachments",
  {
    description:
      "List metadata for files attached directly to a work package. Use before get_work_package_attachment to verify the attachment ID and size; no file content is downloaded.",
    inputSchema: { workPackageId: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  },
  async ({ workPackageId }) => {
    const collection = await api(
      `/api/v3/work_packages/${workPackageId}/attachments`,
    );
    return result(elements(collection).map(compactAttachment));
  },
);

server.registerTool(
  "get_work_package_attachment",
  {
    description:
      "Download one verified attachment from a work package. Use after listing attachments. Text files return readable text; binary files return an embedded base64 MCP resource. The call fails before or during transfer if maxBytes is exceeded and does not write to disk.",
    inputSchema: {
      workPackageId: z.number().int().positive(),
      attachmentId: z.number().int().positive(),
      maxBytes: z.number().int().min(1).max(5_000_000).default(1_000_000).describe("Maximum bytes to return, default 1 MB and hard limit 5 MB"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ workPackageId, attachmentId, maxBytes }) => {
    const collection = await api(
      `/api/v3/work_packages/${workPackageId}/attachments`,
    );
    const attachment = elements(collection).find(
      (candidate) => candidate.id === attachmentId,
    );
    if (!attachment) {
      throw new Error(
        `Attachment ${attachmentId} does not belong to work package ${workPackageId}`,
      );
    }

    const fileName = attachment.fileName ?? `attachment-${attachmentId}`;
    const fileSize = attachment.fileSize ?? attachment.filesize;
    if (typeof fileSize === "number" && fileSize > maxBytes) {
      throw new Error(
        `Attachment is ${fileSize} bytes; increase maxBytes to read it (maximum 5000000)`,
      );
    }

    const downloaded = await api.download(
      `/api/v3/attachments/${attachmentId}/content`,
      maxBytes,
    );
    const contentType = attachment.contentType ?? downloaded.contentType;
    const metadata = JSON.stringify(
      { workPackageId, ...compactAttachment(attachment), contentType },
      null,
      2,
    );

    if (isTextAttachment(fileName, contentType)) {
      return {
        content: [
          { type: "text" as const, text: metadata },
          { type: "text" as const, text: new TextDecoder().decode(downloaded.bytes) },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: metadata },
        {
          type: "resource" as const,
          resource: {
            uri: `openproject://work-packages/${workPackageId}/attachments/${attachmentId}/${encodeURIComponent(fileName)}`,
            mimeType: contentType,
            blob: Buffer.from(downloaded.bytes).toString("base64"),
          },
        },
      ],
    };
  },
);

server.registerTool(
  "create_work_package",
  {
    description:
      "Create a work package and return the created resource plus browser URL. Use only for a new task in a resolved project; this writes immediately and may notify interested users unless notify is false. Omit typeId to select the project's Task type or first available type.",
    inputSchema: {
      projectId: z.number().int().positive(),
      subject: z.string().min(1),
      description: z.string().optional(),
      typeId: z.number().int().positive().optional(),
      assigneeId: z.number().int().positive().optional(),
      priorityId: z.number().int().positive().optional(),
      statusId: z.number().int().positive().optional(),
      responsibleId: z.number().int().positive().optional(),
      parentId: z.number().int().positive().optional(),
      versionId: z.number().int().positive().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      estimatedTime: z.string().regex(/^P/).optional(),
      notify: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({
    projectId,
    subject,
    description,
    typeId,
    assigneeId,
    priorityId,
    statusId,
    responsibleId,
    parentId,
    versionId,
    startDate,
    dueDate,
    estimatedTime,
    notify,
  }) => {
    const resolvedTypeId = await resolveProjectType(projectId, typeId);
    const links: Record<string, HalLink> = {
      type: { href: `/api/v3/types/${resolvedTypeId}` },
    };
    if (assigneeId) links.assignee = { href: `/api/v3/users/${assigneeId}` };
    if (priorityId) links.priority = { href: `/api/v3/priorities/${priorityId}` };
    if (statusId) links.status = { href: `/api/v3/statuses/${statusId}` };
    if (responsibleId) {
      links.responsible = { href: `/api/v3/users/${responsibleId}` };
    }
    if (parentId) links.parent = { href: `/api/v3/work_packages/${parentId}` };
    if (versionId) links.version = { href: `/api/v3/versions/${versionId}` };
    const created = await api(
      `/api/v3/projects/${projectId}/work_packages${notify ? "" : "?notify=false"}`,
      {
      method: "POST",
      body: JSON.stringify({
        subject,
        ...(description
          ? { description: { format: "markdown", raw: description } }
          : {}),
        ...(startDate ? { startDate } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(estimatedTime ? { estimatedTime } : {}),
        _links: links,
      }),
      },
    );
    return result({
      ...created,
      webUrl: workPackageWebUrl(baseUrl, created.id),
    });
  },
);

server.registerTool(
  "update_work_package",
  {
    description:
      "Update only the supplied fields on an existing work package and return its browser URL. The tool fetches the current lockVersion first to prevent stale overwrites; null clears supported optional links. It writes immediately and may notify users unless notify is false.",
    inputSchema: {
      id: z.number().int().positive(),
      subject: z.string().min(1).optional(),
      description: z.string().optional(),
      assigneeId: z.number().int().positive().nullable().optional(),
      priorityId: z.number().int().positive().optional(),
      statusId: z.number().int().positive().optional(),
      responsibleId: z.number().int().positive().nullable().optional(),
      parentId: z.number().int().positive().nullable().optional(),
      versionId: z.number().int().positive().nullable().optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      percentageDone: z.number().int().min(0).max(100).optional(),
      estimatedTime: z.string().regex(/^P/).nullable().optional(),
      notify: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({
    id,
    subject,
    description,
    assigneeId,
    priorityId,
    statusId,
    responsibleId,
    parentId,
    versionId,
    startDate,
    dueDate,
    percentageDone,
    estimatedTime,
    notify,
  }) => {
    const current = await api(`/api/v3/work_packages/${id}`);
    const body = buildWorkPackageUpdatePayload(current.lockVersion, {
      subject,
      description,
      assigneeId,
      priorityId,
      statusId,
      responsibleId,
      parentId,
      versionId,
      startDate,
      dueDate,
      percentageDone,
      estimatedTime,
    });
    const updated = await api(
      `/api/v3/work_packages/${id}${notify ? "" : "?notify=false"}`,
      {
      method: "PATCH",
      body: JSON.stringify(body),
      },
    );
    return result({
      ...updated,
      webUrl: workPackageWebUrl(baseUrl, updated.id),
    });
  },
);

server.registerTool(
  "add_work_package_comment",
  {
    description:
      "Append a Markdown comment to one work package and return the activity plus work-package URL. Use for progress notes or follow-ups, not field changes; this creates a permanent activity and can notify subscribed users.",
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

registerExpandedTools(server, api, baseUrl);

await server.connect(new StdioServerTransport());
