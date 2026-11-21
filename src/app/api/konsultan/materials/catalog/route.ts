import { NextRequest } from "next/server";
import { consultantFailure, consultantJson, requireConsultant } from "@/lib/consultant/http";
import { consultantTutorials } from "@/lib/consultant/materials";

export async function GET(request: NextRequest) {
  try {
    await requireConsultant(request);
    return consultantJson(consultantTutorials);
  } catch (error) {
    return consultantFailure(error);
  }
}
