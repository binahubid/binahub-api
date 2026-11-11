import { NextRequest } from "next/server";
import {
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
export async function GET(req: NextRequest) {
  try {
    return consultantJson(await requireConsultant(req));
  } catch (e) {
    return consultantFailure(e);
  }
}
