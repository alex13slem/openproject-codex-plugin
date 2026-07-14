import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, extname, isAbsolute, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertApiV3Path,
  buildCollectionPath,
  collectionResult,
  compact,
  compactAttachment,
  compactWorkPackage,
  elements,
  type HalLink,
  type HalResource,
  type OpenProjectApi,
  type OpenProjectFilter,
  workPackageWebUrl,
} from "./openproject-api.js";

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

const paginationSchema = {
  offset: z.number().int().positive().default(1).describe("One-based page number"),
  pageSize: z.number().int().min(1).max(100).default(25).describe("Items per page, from 1 to 100"),
};

const relationTypeSchema = z.enum([
  "relates",
  "duplicates",
  "duplicated",
  "blocks",
  "blocked",
  "precedes",
  "follows",
  "includes",
  "partof",
  "requires",
  "required",
]);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function collection(
  resource: HalResource,
  transform: (value: HalResource) => unknown = compact,
) {
  return {
    ...collectionResult(resource),
    elements: elements(resource).map(transform),
  };
}

function link(resource: HalResource, key: string): HalLink | null {
  const value = resource._links?.[key];
  return value && !Array.isArray(value) ? value : null;
}

function summarizeUser(user: HalResource) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    email: user.email,
    status: user.status,
    admin: user.admin,
    self: link(user, "self"),
  };
}

function summarizeReference(resource: HalResource) {
  return {
    id: resource.id,
    name: resource.name,
    position: resource.position,
    isDefault: resource.isDefault,
    isClosed: resource.isClosed,
    color: resource.color,
    status: resource.status,
    startDate: resource.startDate,
    endDate: resource.endDate,
  };
}

function summarizeRelation(resource: HalResource) {
  return {
    id: resource.id,
    type: resource.type,
    reverseType: resource.reverseType,
    description: resource.description,
    lag: resource.lag,
    from: link(resource, "from"),
    to: link(resource, "to"),
  };
}

function summarizeNotification(resource: HalResource) {
  return {
    id: resource.id,
    subject: resource.subject,
    reason: resource.reason,
    read: resource.readIAN,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    project: link(resource, "project"),
    actor: link(resource, "actor"),
    activity: link(resource, "activity"),
    relatedResource: link(resource, "resource"),
  };
}

function contentTypeFor(path: string): string {
  const known: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
  };
  return known[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function assertAllowedUploadPath(
  filePath: string,
  configuredRoots = process.env.OPENPROJECT_ALLOWED_UPLOAD_DIRS,
): string {
  const resolvedFile = realpathSync(filePath);
  const roots = (configuredRoots
    ? configuredRoots.split(delimiter).filter(Boolean)
    : [process.cwd()]
  ).map((root) => realpathSync(root));
  const allowed = roots.some((root) => {
    const child = relative(root, resolvedFile);
    return child === "" || (!child.startsWith("..") && !isAbsolute(child));
  });
  if (!allowed) {
    throw new Error(
      "Upload path is outside OPENPROJECT_ALLOWED_UPLOAD_DIRS " +
        `(default: current working directory): ${resolvedFile}`,
    );
  }
  return resolvedFile;
}

export function registerExpandedTools(
  server: McpServer,
  api: OpenProjectApi,
  baseUrl: string,
) {
  server.registerTool(
    "get_project",
    {
      description:
        "Get one complete project by numeric ID or identifier. Use when the target is already known and full project fields or links are needed; use list_projects for discovery. This is read-only.",
      inputSchema: { idOrIdentifier: z.string().min(1).describe("Numeric project ID or identifier slug") },
      annotations: { readOnlyHint: true },
    },
    async ({ idOrIdentifier }) =>
      result(await api(`/api/v3/projects/${encodeURIComponent(idOrIdentifier)}`)),
  );

  server.registerTool(
    "create_project",
    {
      description:
        "Create a project or subproject immediately. Use only after confirming a new project is wanted; parentId creates it below an existing project. Requires add-project permission and is not idempotent.",
      inputSchema: {
        name: z.string().min(1),
        identifier: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
        description: z.string().optional(),
        public: z.boolean().optional(),
        parentId: z.number().int().positive().optional().describe("Existing parent project ID; omit for a top-level project"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ name, identifier, description, public: isPublic, parentId }) => {
      const created = await api("/api/v3/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          ...(identifier ? { identifier } : {}),
          ...(description
            ? { description: { format: "markdown", raw: description } }
            : {}),
          ...(isPublic !== undefined ? { public: isPublic } : {}),
          ...(parentId
            ? { _links: { parent: { href: `/api/v3/projects/${parentId}` } } }
            : {}),
        }),
      });
      return result(created);
    },
  );

  server.registerTool(
    "update_project",
    {
      description:
        "Patch only the supplied fields on an existing project. Use for renaming, description, visibility, activation, or archival changes; omitted fields are preserved. Requires project administration permission.",
      inputSchema: {
        idOrIdentifier: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        public: z.boolean().optional(),
        active: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ idOrIdentifier, name, description, public: isPublic, active }) => {
      const updated = await api(
        `/api/v3/projects/${encodeURIComponent(idOrIdentifier)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined
              ? { description: { format: "markdown", raw: description } }
              : {}),
            ...(isPublic !== undefined ? { public: isPublic } : {}),
            ...(active !== undefined ? { active } : {}),
          }),
        },
      );
      return result(updated);
    },
  );

  server.registerTool(
    "delete_project",
    {
      description:
        "Permanently schedule deletion of a project by numeric ID. Use only after get_project verifies an explicit deletion target. OpenProject archives it immediately and deletes it asynchronously; this destructive action cannot be undone through this server.",
      inputSchema: { id: z.number().int().positive() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      await api(`/api/v3/projects/${id}`, { method: "DELETE" });
      return result({ deleted: id, asynchronous: true });
    },
  );

  server.registerTool(
    "count_projects",
    {
      description:
        "Return only the total number of projects matching native OpenProject filters. Use instead of list_projects when no project records are needed; this is read-only and minimizes response size.",
      inputSchema: { filters: filterSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ filters }) => {
      const data = await api(
        buildCollectionPath("/api/v3/projects", {
          filters: filters as OpenProjectFilter[] | undefined,
          pageSize: 1,
        }),
      );
      return result({ total: data.total ?? elements(data).length });
    },
  );

  server.registerTool(
    "count_work_packages",
    {
      description:
        "Return only the total number of work packages matching native filters and an optional project. Use instead of search_work_packages when no task records are needed; all filters are combined with AND.",
      inputSchema: {
        projectId: z.number().int().positive().optional(),
        filters: filterSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, filters }) => {
      const combined = [...(filters ?? [])] as OpenProjectFilter[];
      if (projectId) {
        combined.push({
          field: "project",
          operator: "=",
          values: [String(projectId)],
        });
      }
      const data = await api(
        buildCollectionPath("/api/v3/work_packages", {
          filters: combined,
          pageSize: 1,
        }),
      );
      return result({ total: data.total ?? elements(data).length });
    },
  );

  server.registerTool(
    "list_work_package_activities",
    {
      description:
        "List paginated comments and field-change history for one work package. Use for audit context or conversation history; use get_work_package for current state and add_work_package_comment to append a new note. This is read-only.",
      inputSchema: {
        workPackageId: z.number().int().positive(),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ workPackageId, offset, pageSize }) => {
      const data = await api(
        buildCollectionPath(
          `/api/v3/work_packages/${workPackageId}/activities`,
          { offset, pageSize },
        ),
      );
      return result(
        collection(data, (activity) => ({
          id: activity.id,
          version: activity.version,
          comment: activity.comment,
          details: activity.details,
          createdAt: activity.createdAt,
          updatedAt: activity.updatedAt,
          user: link(activity, "user"),
        })),
      );
    },
  );

  server.registerTool(
    "delete_work_package",
    {
      description:
        "Permanently delete one work package by ID. Use only for an explicit deletion request after verifying the target with get_work_package; this is destructive and cannot be undone through this server.",
      inputSchema: { id: z.number().int().positive() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      await api(`/api/v3/work_packages/${id}`, { method: "DELETE" });
      return result({ deleted: id });
    },
  );

  server.registerTool(
    "list_work_package_relations",
    {
      description:
        "List all typed relations involving one work package, including direction and lag. Use to inspect dependencies or duplicates before creating or deleting a relation; this is read-only.",
      inputSchema: { workPackageId: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ workPackageId }) => {
      const data = await api(
        `/api/v3/work_packages/${workPackageId}/relations`,
      );
      return result(collection(data, summarizeRelation));
    },
  );

  server.registerTool(
    "get_work_package_relation",
    {
      description:
        "Get one relation by relation ID, including its from/to links, type, description, and lag. Use after listing relations when complete details for a known relation are needed.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      result(summarizeRelation(await api(`/api/v3/relations/${id}`))),
  );

  server.registerTool(
    "create_work_package_relation",
    {
      description:
        "Create a directed typed relation from one work package to another, such as blocks, precedes, duplicates, or relates. Use after verifying both IDs and existing relations; this writes immediately and duplicate validity is enforced by OpenProject.",
      inputSchema: {
        fromId: z.number().int().positive().describe("Source work-package ID; direction starts here"),
        toId: z.number().int().positive().describe("Target work-package ID; direction points here"),
        type: relationTypeSchema.describe("OpenProject relation type; directional pairs such as blocks/blocked have different meaning"),
        description: z.string().optional(),
        lag: z.number().int().nullable().optional().describe("Optional lag in days for scheduling relations"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ fromId, toId, type, description, lag }) => {
      const created = await api("/api/v3/relations", {
        method: "POST",
        body: JSON.stringify({
          type,
          ...(description !== undefined ? { description } : {}),
          ...(lag !== undefined ? { lag } : {}),
          _links: {
            from: { href: `/api/v3/work_packages/${fromId}` },
            to: { href: `/api/v3/work_packages/${toId}` },
          },
        }),
      });
      return result(summarizeRelation(created));
    },
  );

  server.registerTool(
    "delete_work_package_relation",
    {
      description:
        "Permanently delete one relation without deleting either work package. Use only after list_work_package_relations confirms the relation ID; this destructive change removes the dependency or association.",
      inputSchema: { id: z.number().int().positive() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      await api(`/api/v3/relations/${id}`, { method: "DELETE" });
      return result({ deleted: id });
    },
  );

  server.registerTool(
    "upload_work_package_attachment",
    {
      description:
        "Read one explicit allowlisted local file and upload it to a work package. Use only when the user identified both the file and target task. Paths must be under OPENPROJECT_ALLOWED_UPLOAD_DIRS (default: current working directory). The call rejects files above maxBytes, sends bytes only to the configured OpenProject origin, creates a permanent attachment, and never modifies the local file.",
      inputSchema: {
        workPackageId: z.number().int().positive(),
        filePath: z.string().min(1).describe("Explicit local file path to read and upload"),
        description: z.string().optional(),
        maxBytes: z.number().int().min(1).max(50_000_000).default(10_000_000).describe("Maximum local file size, default 10 MB and hard limit 50 MB"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workPackageId, filePath, description, maxBytes }) => {
      const allowedPath = assertAllowedUploadPath(filePath);
      const fileSize = statSync(allowedPath).size;
      if (fileSize > maxBytes) {
        throw new Error(
          `File is ${fileSize} bytes; the configured limit is ${maxBytes} bytes`,
        );
      }
      const uploaded = await api.upload(
        `/api/v3/work_packages/${workPackageId}/attachments`,
        basename(allowedPath),
        contentTypeFor(allowedPath),
        readFileSync(allowedPath),
        description,
      );
      return result(compactAttachment(uploaded));
    },
  );

  server.registerTool(
    "delete_work_package_attachment",
    {
      description:
        "Permanently delete one attachment by attachment ID. Use only after list_work_package_attachments verifies the file and ID; this is destructive and does not delete the work package.",
      inputSchema: { attachmentId: z.number().int().positive() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ attachmentId }) => {
      await api(`/api/v3/attachments/${attachmentId}`, { method: "DELETE" });
      return result({ deleted: attachmentId });
    },
  );

  server.registerTool(
    "get_current_user",
    {
      description:
        "Return the current OpenProject user authenticated by the API token. Use to identify 'me' or verify credentials; unlike list_users, this does not require global user-management permission.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result(summarizeUser(await api("/api/v3/users/me"))),
  );

  server.registerTool(
    "list_users",
    {
      description:
        "List or search the global OpenProject user directory with native filters and pagination. Use for administrator-level discovery; for ordinary task assignment prefer list_available_assignees because OpenProject may restrict this endpoint to user managers. This is read-only.",
      inputSchema: {
        query: z.string().optional(),
        filters: filterSchema,
        sortBy: sortSchema,
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, filters, sortBy, offset, pageSize }) => {
      const combined = [...(filters ?? [])] as OpenProjectFilter[];
      if (query) {
        combined.push({ field: "name", operator: "~", values: [query] });
      }
      const data = await api(
        buildCollectionPath("/api/v3/users", {
          filters: combined,
          sortBy,
          offset,
          pageSize,
        }),
      );
      return result(collection(data, summarizeUser));
    },
  );

  server.registerTool(
    "get_user",
    {
      description:
        "Get one OpenProject user by numeric ID. Use when the ID is already known; use list_available_assignees for assignment choices and list_users for administrator-level discovery.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => result(summarizeUser(await api(`/api/v3/users/${id}`))),
  );

  server.registerTool(
    "list_available_assignees",
    {
      description:
        "List users permitted as assignees for exactly one project or work package. Use this before assignment when the global user list is unavailable; provide projectId or workPackageId, never both. This is read-only.",
      inputSchema: {
        projectId: z.number().int().positive().optional().describe("Project to find valid assignees for; mutually exclusive with workPackageId"),
        workPackageId: z.number().int().positive().optional().describe("Work package to find valid assignees for; mutually exclusive with projectId"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, workPackageId }) => {
      if ((projectId ? 1 : 0) + (workPackageId ? 1 : 0) !== 1) {
        throw new Error("Provide exactly one of projectId or workPackageId");
      }
      const path = projectId
        ? `/api/v3/projects/${projectId}/available_assignees`
        : `/api/v3/work_packages/${workPackageId}/available_assignees`;
      return result(collection(await api(path), summarizeUser));
    },
  );

  for (const definition of [
    ["list_work_package_types", "/api/v3/types", "work package types"],
    ["list_work_package_statuses", "/api/v3/statuses", "work package statuses"],
    ["list_work_package_priorities", "/api/v3/priorities", "work package priorities"],
  ] as const) {
    const [name, path, label] = definition;
    server.registerTool(
      name,
      {
        description: `List configured OpenProject ${label} and their IDs. Use this read-only discovery tool before creating, filtering, or updating work packages that reference ${label}.`,
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => result(collection(await api(path), summarizeReference)),
    );
  }

  server.registerTool(
    "list_project_versions",
    {
      description:
        "List version or milestone IDs globally or for one project. Use before assigning a work package to a version; projectId returns only versions available in that project. This is read-only.",
      inputSchema: {
        projectId: z.number().int().positive().optional(),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, offset, pageSize }) => {
      const path = projectId
        ? `/api/v3/projects/${projectId}/versions`
        : "/api/v3/versions";
      const data = await api(
        buildCollectionPath(path, { offset, pageSize }),
      );
      return result(collection(data, summarizeReference));
    },
  );

  server.registerTool(
    "list_work_package_watchers",
    {
      description:
        "List current watchers of one work package. Use before adding or removing a watcher to verify membership and user IDs; this does not change subscriptions.",
      inputSchema: { workPackageId: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ workPackageId }) => {
      const data = await api(
        `/api/v3/work_packages/${workPackageId}/watchers`,
      );
      return result(collection(data, summarizeUser));
    },
  );

  server.registerTool(
    "add_work_package_watcher",
    {
      description:
        "Subscribe a user as a watcher of one work package so OpenProject can notify them about changes. Use only for an explicit subscription request; adding an existing watcher is idempotent.",
      inputSchema: {
        workPackageId: z.number().int().positive(),
        userId: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ workPackageId, userId }) => {
      const watcher = await api(
        `/api/v3/work_packages/${workPackageId}/watchers`,
        {
          method: "POST",
          body: JSON.stringify({ user: { href: `/api/v3/users/${userId}` } }),
        },
      );
      return result(summarizeUser(watcher));
    },
  );

  server.registerTool(
    "remove_work_package_watcher",
    {
      description:
        "Unsubscribe a user from one work package's watchers. Use only after verifying workPackageId and userId; this changes notification behavior but does not delete the user or work package.",
      inputSchema: {
        workPackageId: z.number().int().positive(),
        userId: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ workPackageId, userId }) => {
      await api(`/api/v3/work_packages/${workPackageId}/watchers/${userId}`, {
        method: "DELETE",
      });
      return result({ removed: userId, workPackageId });
    },
  );

  server.registerTool(
    "list_notifications",
    {
      description:
        "List paginated in-app notifications for the authenticated user, optionally unread only. Use for inbox triage; this leaves read state unchanged. Use get_notification for one item's details and mark tools only after review.",
      inputSchema: {
        unreadOnly: z.boolean().default(false),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ unreadOnly, offset, pageSize }) => {
      const data = await api(
        buildCollectionPath("/api/v3/notifications", {
          filters: unreadOnly
            ? [{ field: "readIAN", operator: "=", values: ["f"] }]
            : undefined,
          sortBy: [["id", "desc"]],
          offset,
          pageSize,
        }),
      );
      return result(collection(data, summarizeNotification));
    },
  );

  server.registerTool(
    "get_notification",
    {
      description:
        "Get one in-app notification by ID with actor, project, activity, and related-resource links. Use after list_notifications when full context for a known notification is required; it remains unread.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      result(summarizeNotification(await api(`/api/v3/notifications/${id}`))),
  );

  server.registerTool(
    "mark_notification_read",
    {
      description:
        "Mark one in-app notification as read for the authenticated user. Use after the notification has been reviewed; this changes inbox state but not the related project resource.",
      inputSchema: { id: z.number().int().positive() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      await api(`/api/v3/notifications/${id}/read_ian`, { method: "POST" });
      return result({ id, read: true });
    },
  );

  server.registerTool(
    "mark_all_notifications_read",
    {
      description:
        "Mark every visible in-app notification as read for the authenticated user. Use only for an explicit clear-inbox request; this bulk state change is idempotent and does not modify related work packages.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      await api("/api/v3/notifications/read_ian", { method: "POST" });
      return result({ allRead: true });
    },
  );

  server.registerTool(
    "list_boards",
    {
      description:
        "List paginated Kanban-style boards scoped to one project ID or identifier. Use to discover board grid IDs; use get_board for configuration or list_board_lanes for cards. This read-only call may return no boards when the module is disabled.",
      inputSchema: {
        projectIdOrIdentifier: z.string().min(1).describe("Numeric project ID or identifier used in the board scope"),
        ...paginationSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectIdOrIdentifier, offset, pageSize }) => {
      const scope = `/projects/${projectIdOrIdentifier}/boards`;
      const data = await api(
        buildCollectionPath("/api/v3/grids", {
          filters: [{ field: "scope", operator: "=", values: [scope] }],
          offset,
          pageSize,
        }),
      );
      return result(
        collection(data, (board) => ({
          id: board.id,
          name: board.name,
          rowCount: board.rowCount,
          columnCount: board.columnCount,
          widgets: board.widgets,
          scope: link(board, "scope"),
        })),
      );
    },
  );

  server.registerTool(
    "get_board",
    {
      description:
        "Get one OpenProject board by grid ID, including its widget and column configuration. Use when the board ID is already known; use list_boards for project discovery or list_board_lanes for cards.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => result(await api(`/api/v3/grids/${id}`)),
  );

  server.registerTool(
    "list_board_lanes",
    {
      description:
        "Resolve one board's work-package query widgets into lanes with card summaries and pagination metadata. Use after list_boards identifies a board; pageSize limits cards per lane. This is read-only and does not move cards.",
      inputSchema: {
        boardId: z.number().int().positive().describe("Board grid ID returned by list_boards"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Maximum cards requested for each lane"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, pageSize }) => {
      const board = await api(`/api/v3/grids/${boardId}`);
      const widgets = Array.isArray(board.widgets) ? board.widgets : [];
      const queryIds = widgets
        .map((widget) => {
          if (!widget || typeof widget !== "object") return undefined;
          const options = (widget as Record<string, unknown>).options;
          if (!options || typeof options !== "object") return undefined;
          const queryId = (options as Record<string, unknown>).queryId;
          return typeof queryId === "number" ? queryId : undefined;
        })
        .filter((id): id is number => id !== undefined);
      const queries = await Promise.all(
        queryIds.map((id) =>
          api(buildCollectionPath(`/api/v3/queries/${id}`, { pageSize })),
        ),
      );
      return result({
        boardId,
        name: board.name,
        lanes: queries.map((query, index) => {
          const embedded = query._embedded as
            | { results?: HalResource }
            | undefined;
          const results = embedded?.results ?? {};
          return {
            queryId: queryIds[index],
            name: query.name,
            ...collectionResult(results),
            cards: elements(results).map((workPackage) =>
              compactWorkPackage(workPackage, baseUrl),
            ),
          };
        }),
      });
    },
  );

  server.registerTool(
    "get_openproject_api",
    {
      description:
        "Read an OpenProject API v3 endpoint not covered by a focused tool. Use only as a read-only escape hatch after checking the typed tools. The path must be relative under /api/v3; absolute URLs, other origins, writes, and filesystem access are rejected.",
      inputSchema: {
        path: z.string().min(1).describe("For example: /api/v3/queries/42"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path }) => result(await api(assertApiV3Path(path))),
  );

}
