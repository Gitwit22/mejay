import { requireSessionUserId } from "../_auth";

const ZIP_KEY = "MOCK FULL PROGRAM.zip"; // MUST match R2 key exactly
const FILE_NAME = "MeJay-Full-Program.zip";

export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const userId = await requireSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const ent = await env.DB.prepare(
    `SELECT access_type, has_full_access FROM entitlements WHERE user_id = ?1`
  )
    .bind(userId)
    .first() as { access_type: string; has_full_access: number } | null;

  const hasFull =
    ent?.has_full_access === 1 ||
    ent?.access_type === "full_program" ||
    ent?.access_type === "full";

  if (!hasFull) return new Response("Forbidden", { status: 403 });

  const obj = await env.DOWNLOADS.get(ZIP_KEY);
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
