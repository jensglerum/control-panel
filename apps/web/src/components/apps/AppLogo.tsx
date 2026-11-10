import {
  AppWindowIcon,
  CodeXmlIcon,
  MonitorIcon,
  PlugIcon,
  SquareTerminalIcon,
} from "lucide-react";

import amie from "../../assets/apps/amie.png";
import apify from "../../assets/apps/apify.svg";
import atlassian from "../../assets/apps/atlassian.png";
import beeper from "../../assets/apps/beeper.png";
import clickup from "../../assets/apps/clickup.png";
import loom from "../../assets/apps/loom.png";
import mobbin from "../../assets/apps/mobbin.svg";
import slush from "../../assets/apps/slush.png";
import type { AppBrand, AppPresentation } from "./appPresentation.logic";

const LOGOS: Record<AppBrand, string> = {
  amie,
  apify,
  atlassian,
  beeper,
  clickup,
  loom,
  mobbin,
  slush,
};

export function AppLogo({ app }: { readonly app: AppPresentation }) {
  const SystemIcon =
    app.systemTool === "computer"
      ? MonitorIcon
      : app.systemTool === "browser"
        ? AppWindowIcon
        : app.systemTool === "javascript"
          ? CodeXmlIcon
          : app.systemTool === "workspace"
            ? SquareTerminalIcon
            : PlugIcon;
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background"
      aria-hidden
    >
      {app.brand ? (
        <img
          src={LOGOS[app.brand]}
          alt=""
          className="size-7 object-contain"
          width={28}
          height={28}
        />
      ) : (
        <SystemIcon className="size-5 text-muted-foreground" />
      )}
    </span>
  );
}
