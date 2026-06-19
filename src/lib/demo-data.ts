export const clientProgress = [
  {
    client: "Andini Pratama",
    organization: "Demo Organization",
    binainsight: "Completed",
    binaimpact: "Level 1 Completed",
  },
  {
    client: "Raka Mahendra",
    organization: "Demo Organization",
    binainsight: "Not Started",
    binaimpact: "In Progress",
  },
];

export const facilitatorReviews = [
  {
    client: "Andini Pratama",
    module: "BinaImpact",
    model: "Model A",
    status: "Awaiting Review",
  },
  {
    client: "Andini Pratama",
    module: "BinaInsight",
    model: "Assessment Result",
    status: "Reviewed",
  },
];

export const impactModels = ["Model A", "Model B", "Model C", "Model D"].map(
  (name, index) => ({
    id: `model-${index + 1}`,
    name,
    levels: [
      { name: "Level 1", sections: ["Bagian 1", "Bagian 2", "Bagian 3"] },
      {
        name: "Level 2",
        sections: ["Pre-test", "Post-test", "Penilaian Fasilitator"],
      },
    ],
  }),
);
