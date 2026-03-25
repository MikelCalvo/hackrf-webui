import type { NextRequest } from "next/server";

import type {
  ActivityEventModule,
  CreateActivityEventInput,
} from "@/lib/activity-events";
import {
  clearActivityEvents,
  createActivityEvent,
  listActivityEvents,
} from "@/server/activity-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODULES = new Set<ActivityEventModule>(["pmr", "airband", "maritime"]);

function parseModule(value: string | null): ActivityEventModule | null {
  if (!value) {
    return null;
  }

  return VALID_MODULES.has(value as ActivityEventModule)
    ? (value as ActivityEventModule)
    : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const moduleId = parseModule(request.nextUrl.searchParams.get("module"));
  if (!moduleId) {
    return Response.json({ message: "Invalid or missing module." }, { status: 400 });
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "25", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 25;

  return Response.json(
    {
      events: listActivityEvents(moduleId, limit),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: CreateActivityEventInput;

  try {
    payload = (await request.json()) as CreateActivityEventInput;
  } catch {
    return Response.json({ message: "Invalid JSON payload." }, { status: 400 });
  }

  const moduleId = parseModule(payload.module);
  if (!moduleId || !payload.label || !Number.isFinite(payload.freqMhz) || !Number.isFinite(payload.rms)) {
    return Response.json({ message: "Invalid activity event payload." }, { status: 400 });
  }

  const event = createActivityEvent({
    ...payload,
    module: moduleId,
  });

  return Response.json(event, { status: 201 });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const moduleId = parseModule(request.nextUrl.searchParams.get("module"));
  if (!moduleId) {
    return Response.json({ message: "Invalid or missing module." }, { status: 400 });
  }

  clearActivityEvents(moduleId);
  return new Response(null, { status: 204 });
}
