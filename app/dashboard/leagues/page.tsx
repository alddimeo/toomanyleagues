import { cookies } from "next/headers";
import { DashboardShell } from "@/components/DashboardShell";

export default async function LeaguesPage() {
  await cookies();
  return <DashboardShell focus="leagues" />;
}
