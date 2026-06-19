export const roles = ["admin", "client", "facilitator"] as const;

export type Role = (typeof roles)[number];

export const roleHome: Record<Role, string> = {
  admin: "/admin/dashboard",
  client: "/client/dashboard",
  facilitator: "/facilitator/dashboard",
};

export function isRole(value: string | null | undefined): value is Role {
  return roles.includes(value as Role);
}
