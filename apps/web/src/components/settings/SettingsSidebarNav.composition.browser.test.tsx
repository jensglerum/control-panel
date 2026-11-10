import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [
    { id: "theme", title: "Theme", to: "/settings/appearance" },
    { id: "worktree-location", title: "Worktree location", to: "/settings/worktrees" },
  ],
}));

it("ignores composing keys in the search", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });
  await search.fill("theme");
  await expect.element(page.getByRole("option", { name: /Theme/ })).toBeVisible();

  for (const composition of [
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Escape", isComposing: true, keyCode: 27 },
    { key: "Escape", isComposing: false, keyCode: 229 },
    { key: "ArrowDown", isComposing: true, keyCode: 40 },
    { key: "ArrowUp", isComposing: true, keyCode: 38 },
  ]) {
    const event = new KeyboardEvent("keydown", { ...composition, bubbles: true, cancelable: true });
    await act(() => search.element().dispatchEvent(event));
    expect(event.defaultPrevented, JSON.stringify(composition)).toBe(false);
    expect(screen.router?.state.location.pathname).toBe("/settings/general");
    await expect.element(search).toHaveValue("theme");
  }

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/settings/appearance"),
  );
});

it("finds a folded section through search and keeps keyboard focus in visible sections", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const advanced = screen.getByRole("button", { name: "Advanced settings", exact: true });
  await expect.element(advanced).toHaveAttribute("aria-expanded", "false");
  const general = screen.getByRole("treeitem", { name: "General", exact: true });
  await general.click();
  await userEvent.keyboard("{End}");
  await expect
    .element(screen.getByRole("treeitem", { name: "Archive", exact: true }))
    .toHaveFocus();

  const search = screen.getByRole("combobox", { name: "Search settings" });
  await search.fill("worktree location");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/settings/worktrees"),
  );
  await expect.element(advanced).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByRole("treeitem", { name: "Worktrees" })).toBeVisible();
});

it("reveals the technical section for a direct settings link", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/providers" />
    </SidebarProvider>,
    { router: "/settings/providers" },
  );
  await expect
    .element(screen.getByRole("button", { name: "Advanced settings", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  await expect
    .element(screen.getByRole("treeitem", { name: "Providers" }))
    .toHaveAttribute("tabindex", "0");
});
