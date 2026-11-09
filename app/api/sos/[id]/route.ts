import { transitionSos } from "../../../../lib/server/operations";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return transitionSos(request, (await context.params).id);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return transitionSos(request, (await context.params).id);
}
