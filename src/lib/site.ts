// Central site configuration used for metadata, SEO, sitemap, and robots.
// Override the production URL via the NEXT_PUBLIC_SITE_URL env var when the
// custom domain (e.g. https://binahub.id) goes live.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://preview-binahub.vercel.app"
).replace(/\/+$/, "");

export const SITE_NAME = "BinaHub";

export const SITE_TAGLINE = "Human Transformation & Future Capability Partner";

export const SITE_DESCRIPTION =
  "Mendorong transformasi manusia dan organisasi untuk memanusiawikan masa depan. BinaHub hadir sebagai mitra transformasi bagi individu, pemimpin, dan organisasi.";

export const SITE_DESCRIPTION_EN =
  "Driving human and organizational transformation to humanize the future. BinaHub is a transformation partner for individuals, leaders, and organizations.";

export const SITE_KEYWORDS = [
  "BinaHub",
  "transformasi organisasi",
  "pengembangan SDM",
  "executive coaching",
  "leadership development",
  "talent assessment",
  "future capability",
  "people development Indonesia",
];

export const SITE_KEYWORDS_EN = [
  "BinaHub",
  "organizational transformation",
  "people development",
  "executive coaching",
  "leadership development",
  "talent assessment",
  "future capability",
  "human transformation partner",
];
