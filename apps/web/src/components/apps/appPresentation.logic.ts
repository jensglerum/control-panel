import type { ProviderMcpServer, ProviderMcpServerCheck } from "@t3tools/contracts";

export type AppBrand =
  | "amie"
  | "apify"
  | "beeper"
  | "clickup"
  | "mobbin"
  | "slush"
  | "loom"
  | "atlassian";
export type SystemTool = "workspace" | "computer" | "browser" | "javascript";

export interface AppPresentation {
  readonly name: string;
  readonly brand?: AppBrand;
  readonly systemTool?: SystemTool;
}

const APP_NAMES: Record<AppBrand, string> = {
  amie: "Amie",
  apify: "Apify",
  beeper: "Beeper",
  clickup: "ClickUp",
  mobbin: "Mobbin",
  slush: "Slush",
  loom: "Loom",
  atlassian: "Atlassian",
};

const BRAND_HOSTS: ReadonlyArray<readonly [AppBrand, readonly string[]]> = [
  ["amie", ["amie.so"]],
  ["apify", ["apify.com"]],
  ["beeper", ["beeper.com"]],
  ["clickup", ["clickup.com"]],
  ["mobbin", ["mobbin.com"]],
  ["slush", ["slush.org"]],
  ["loom", ["loom.com"]],
  ["atlassian", ["atlassian.com"]],
];

const SYSTEM_TOOLS: Record<string, AppPresentation> = {
  codex_app: { name: "Workspace tools", systemTool: "workspace" },
  codex_apps: { name: "Workspace tools", systemTool: "workspace" },
  "computer-use": { name: "Computer control", systemTool: "computer" },
  computer_use: { name: "Computer control", systemTool: "computer" },
  cua_repl: { name: "Browser and app control", systemTool: "browser" },
  node_repl: { name: "JavaScript runtime", systemTool: "javascript" },
};

export function appPresentation(
  server: Pick<ProviderMcpServer, "name" | "endpointOrigin">,
): AppPresentation {
  let host: string | undefined;
  try {
    host = server.endpointOrigin
      ? new URL(server.endpointOrigin).hostname.toLowerCase()
      : undefined;
  } catch {
    // Older environments can report an origin that is not a URL. Keep the saved name as fallback.
  }
  // A known endpoint wins over an arbitrary saved alias, such as "loom" at Atlassian's endpoint.
  const hostBrand = BRAND_HOSTS.find(([, domains]) =>
    domains.some((domain) => host === domain || host?.endsWith(`.${domain}`)),
  )?.[0];
  if (hostBrand) return { name: APP_NAMES[hostBrand], brand: hostBrand };

  const normalized = server.name
    .toLowerCase()
    .replace(/^mcp[-_]/, "")
    .replace(/[-_]mcp$/, "");
  const systemTool = Object.hasOwn(SYSTEM_TOOLS, normalized) ? SYSTEM_TOOLS[normalized] : undefined;
  if (systemTool) return systemTool;
  const brand = Object.keys(APP_NAMES).find((key) => key === normalized) as AppBrand | undefined;
  return brand ? { name: APP_NAMES[brand], brand } : { name: server.name };
}

export function appConnectionStatus(
  server: Pick<ProviderMcpServer, "enabled" | "authStatus">,
  check: ProviderMcpServerCheck | null,
  requestFailed = false,
) {
  if (!server.enabled || check?.status === "disabled") {
    return {
      label: "Disabled",
      variant: "secondary",
      message: "This tool is disabled in this profile.",
    } as const;
  }
  if (requestFailed) {
    return {
      label: "Couldn't check",
      variant: "warning",
      message: "The check request failed. Try again when this environment is available.",
    } as const;
  }
  if (check) {
    switch (check.status) {
      case "working":
        return { label: "Working", variant: "success", message: check.message } as const;
      case "auth_required":
        return { label: "Needs sign-in", variant: "warning", message: check.message } as const;
      case "not_connected":
        return { label: "Not connected", variant: "warning", message: check.message } as const;
      case "failed":
      case "unknown":
        return { label: "Couldn't check", variant: "warning", message: check.message } as const;
    }
  }
  return server.authStatus === "not_logged_in"
    ? ({
        label: "Needs sign-in",
        variant: "warning",
        message:
          "The provider reports that sign-in is required. The connection has not been tested.",
      } as const)
    : ({
        label: "Not checked",
        variant: "outline",
        message: "Saved in this profile. Check the connection to verify that it works.",
      } as const);
}
