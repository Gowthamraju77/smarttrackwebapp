import { listOperations } from "../../../lib/server/operations";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return listOperations(request, "devices");
}
