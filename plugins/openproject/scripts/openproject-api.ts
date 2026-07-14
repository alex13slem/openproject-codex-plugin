export type HalLink = { href?: string | null; title?: string };

export type HalResource = Record<string, unknown> & {
  id?: number;
  subject?: string;
  name?: string;
  identifier?: string;
  lockVersion?: number;
  startDate?: string | null;
  dueDate?: string | null;
  percentageDone?: number | null;
  _links?: Record<string, HalLink | HalLink[]>;
  _embedded?: { elements?: HalResource[] };
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createOpenProjectApi(
  baseUrl: string,
  apiToken: string,
  fetchImpl: FetchLike = fetch,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  return async function api<T extends HalResource>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/hal+json");
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${apiToken}`);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // Preserve a non-JSON error response for diagnostics.
    }
    if (!response.ok) {
      throw new Error(
        `OpenProject HTTP ${response.status}: ${JSON.stringify(body).slice(0, 2000)}`,
      );
    }
    return body as T;
  };
}

export function elements(resource: HalResource): HalResource[] {
  return resource._embedded?.elements ?? [];
}

export function compact(resource: HalResource): Record<string, unknown> {
  return {
    id: resource.id,
    name: resource.name,
    identifier: resource.identifier,
    subject: resource.subject,
    lockVersion: resource.lockVersion,
    links: resource._links,
  };
}

function linkedResource(resource: HalResource, key: string): HalLink | null {
  const link = resource._links?.[key];
  return link && !Array.isArray(link) ? link : null;
}

export function compactWorkPackage(
  resource: HalResource,
): Record<string, unknown> {
  return {
    id: resource.id,
    subject: resource.subject,
    startDate: resource.startDate,
    dueDate: resource.dueDate,
    percentageDone: resource.percentageDone,
    project: linkedResource(resource, "project"),
    type: linkedResource(resource, "type"),
    status: linkedResource(resource, "status"),
    priority: linkedResource(resource, "priority"),
    assignee: linkedResource(resource, "assignee"),
    self: linkedResource(resource, "self"),
  };
}

export function buildWorkPackageSearchPath({
  query,
  projectId,
  assigneeId,
  dueDate,
  statusId,
  statusCategory,
  pageSize,
}: {
  query?: string;
  projectId?: number;
  assigneeId?: number;
  dueDate?: string;
  statusId?: number;
  statusCategory?: "open" | "closed";
  pageSize: number;
}): string {
  const filters: Record<string, unknown>[] = [];
  if (query) filters.push({ subject: { operator: "~", values: [query] } });
  if (projectId) {
    filters.push({ project: { operator: "=", values: [String(projectId)] } });
  }
  if (assigneeId) {
    filters.push({ assignee: { operator: "=", values: [String(assigneeId)] } });
  }
  if (dueDate) {
    filters.push({ dueDate: { operator: "=d", values: [dueDate] } });
  }
  if (statusId) {
    filters.push({ status: { operator: "=", values: [String(statusId)] } });
  } else if (statusCategory) {
    filters.push({
      status: {
        operator: statusCategory === "open" ? "o" : "c",
        values: [],
      },
    });
  }
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (filters.length) params.set("filters", JSON.stringify(filters));
  return `/api/v3/work_packages?${params}`;
}

export function buildWorkPackageUpdatePayload(
  lockVersion: number | undefined,
  input: {
    subject?: string;
    description?: string;
    assigneeId?: number | null;
    priorityId?: number;
    statusId?: number;
  },
): Record<string, unknown> {
  const links: Record<string, HalLink> = {};
  if (input.assigneeId !== undefined) {
    links.assignee = {
      href: input.assigneeId ? `/api/v3/users/${input.assigneeId}` : null,
    };
  }
  if (input.priorityId) {
    links.priority = { href: `/api/v3/priorities/${input.priorityId}` };
  }
  if (input.statusId) {
    links.status = { href: `/api/v3/statuses/${input.statusId}` };
  }

  return {
    lockVersion,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.description !== undefined
      ? { description: { format: "markdown", raw: input.description } }
      : {}),
    ...(Object.keys(links).length ? { _links: links } : {}),
  };
}
