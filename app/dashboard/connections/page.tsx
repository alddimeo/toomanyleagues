import { cookies } from "next/headers";
import { DashboardShell } from "@/components/DashboardShell";

export default async function ConnectionsPage() {
  await cookies();
  return <DashboardShell focus="connections" />;
}
