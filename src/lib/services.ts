import type { Role } from "@/lib/roles";

export type ServiceStatus = "active" | "on_develop";
export type ServiceAccessRole = Role | "public";

export type ServiceModule = {
  slug: string;
  name: string;
  href: string;
  icon: string;
  status: ServiceStatus;
  access: ServiceAccessRole[];
};

export const services: ServiceModule[] = [
  {
    slug: "binainsight",
    name: "BinaInsight",
    href: "/insight",
    icon: "/asset/insights.png",
    status: "active",
    access: ["public", "client"],
  },
  {
    slug: "binaimpact",
    name: "BinaImpact",
    href: "/binaimpact",
    icon: "/asset/impact.png",
    status: "active",
    access: ["client", "facilitator", "admin"],
  },
  {
    slug: "binalab",
    name: "BinaLab",
    href: "/services/binalab",
    icon: "/asset/lab.png",
    status: "on_develop",
    access: ["facilitator", "admin"],
  },
  {
    slug: "binacoach",
    name: "BinaCoach",
    href: "/services/binacoach",
    icon: "/asset/coach.png",
    status: "on_develop",
    access: ["client", "facilitator"],
  },
  {
    slug: "binaplay",
    name: "BinaPlay",
    href: "/services/binaplay",
    icon: "/asset/play.png",
    status: "on_develop",
    access: ["client", "facilitator"],
  },
  {
    slug: "binaacademy",
    name: "BinaAcademy",
    href: "/services/binaacademy",
    icon: "/asset/academy.png",
    status: "on_develop",
    access: ["client"],
  },
  {
    slug: "binajourney",
    name: "BinaJourney",
    href: "/services/binajourney",
    icon: "/asset/journey.png",
    status: "on_develop",
    access: ["client", "facilitator", "admin"],
  },
  {
    slug: "binaworks",
    name: "BinaWorks",
    href: "/services/binaworks",
    icon: "/asset/works.png",
    status: "on_develop",
    access: ["facilitator", "admin"],
  },
];
