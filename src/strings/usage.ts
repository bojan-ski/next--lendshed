export const usage = {
  title: "Usage",
  description: "Uploads, photo storage and listed items against the free plans",
  monthLine: "· the app's own counts",
  uploadsTitle: "Photo uploads",
  storageTitle: "Photo storage",
  listedTitle: "Listed items",
  megabytes: "{amount} MB",
  usedOf: "{used} of {limit}",
  percent: "({percent}%)",
  valueText: "{used} of {limit}, {percent}%",
  capWarning:
    "Past {percent}% of the free limit. Photo uploads stop at the limit.",
  listedWarning:
    "{limit} listed items is the free plan's image budget for a month.",
  note: "Transfer and operations aren't counted here. Vercel's dashboard is the final word.",
  link: "Open your Vercel dashboard, then Usage",
} as const;
