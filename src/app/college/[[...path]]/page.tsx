import { Workspace } from "@/components/workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return <Workspace collegeId={path?.[0]} page={path?.[1] || "dashboard"} />;
}
