import { describe, expect, it } from "vitest";
import {
  assessmentActionSchema,
  assessmentStatusUpdateSchema,
  contactUpdateSchema,
  inquiryUpdateSchema,
} from "./admin-mutation-schemas";

const id = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("admin mutation schemas", () => {
  it("accepts known dashboard mutations", () => {
    expect(contactUpdateSchema.safeParse({ id, status: "Qualified", notes: "Siap dihubungi" }).success).toBe(true);
    expect(inquiryUpdateSchema.safeParse({ id, status: "Dibalas", notes: "Sudah dibalas" }).success).toBe(true);
    expect(assessmentStatusUpdateSchema.safeParse({
      id,
      assessmentStatus: "Result Email Terkirim",
      proposalStatus: "Belum Diminta",
    }).success).toBe(true);
    expect(assessmentActionSchema.safeParse({ id, action: "send_proposal" }).success).toBe(true);
  });

  it("rejects arbitrary statuses, actions, IDs, and oversized notes", () => {
    expect(contactUpdateSchema.safeParse({ id, status: "super-admin", notes: "" }).success).toBe(false);
    expect(inquiryUpdateSchema.safeParse({ id, status: "drop table", notes: "" }).success).toBe(false);
    expect(assessmentActionSchema.safeParse({ id, action: "delete_everything" }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ id: "not-a-uuid", status: "Qualified", notes: "" }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ id, status: "Qualified", notes: "x".repeat(4001) }).success).toBe(false);
  });
});
