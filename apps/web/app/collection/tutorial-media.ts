// Refresh cached recordings after the switch from kilograms to tonnes.
const version = "onboarding-2026-11-12";
export const tutorialMediaUrl = (id: string, extension: "mp4" | "jpg") =>
  `/downloads/tutorials/${id}.${extension}?v=${version}`;
export const tutorialArchiveUrl = `/downloads/tutorials/collection-tutorials.zip?v=${version}`;
