import { createFileRoute } from "@tanstack/react-router";
import { AppsPage } from "../components/apps/AppsPage";

export const Route = createFileRoute("/_chat/apps")({ component: AppsPage });
