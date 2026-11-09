import { handleDeviceIngest } from "../../../lib/server/ingest";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleDeviceIngest(request, "sos");
}
