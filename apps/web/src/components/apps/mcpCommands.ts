import type { ProviderMcpInventory } from "@t3tools/contracts";

function quote(value: string, windows: boolean): string {
  return windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
}

export function mcpCommand(inventory: ProviderMcpInventory, args: readonly string[]): string {
  const windows = inventory.platform === "win32";
  const binary = quote(inventory.binaryPath, windows);
  const home = quote(inventory.homePath, windows);
  const prefix = windows
    ? `$env:CODEX_HOME = ${home}; & ${binary}`
    : `CODEX_HOME=${home} ${binary}`;
  return `${prefix} mcp ${args.map((arg) => quote(arg, windows)).join(" ")}`;
}

export function mcpSetupCommand(
  inventory: ProviderMcpInventory,
  name: string,
  endpoint: string,
): { command: string; error: null } | { command: null; error: string } {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    return {
      command: null,
      error:
        "Use a name beginning with a letter, followed by letters, numbers, dashes or underscores.",
    };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { command: null, error: "Enter the MCP server's full HTTP or HTTPS URL." };
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return {
      command: null,
      error:
        "Use an HTTP or HTTPS endpoint without a password, query string or fragment. Sign in through the provider when needed.",
    };
  }
  return { command: mcpCommand(inventory, ["add", name, "--url", url.href]), error: null };
}
