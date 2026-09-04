import type { ResumeExperience, SocialRecord } from "./simple-verification";

export type OverrideField =
  | "resumeCompany"
  | "socialCompany"
  | "resumeStartMonth"
  | "resumeEndMonth"
  | "socialStartMonth"
  | "socialEndMonth"
  | "startMonth"
  | "endMonth"
  | "position"
  | "paymentType"
  | "unitCompany";

export type OverrideKind = "confirm" | "correct";

export type FieldOverride = {
  id: string;
  rowIndex: number;
  targetId?: string;
  field: OverrideField;
  originalValue: string | null;
  systemValue: string | null;
  overrideValue: string | null;
  kind?: OverrideKind;
  reviewStatus: "applied" | "reverted";
  updatedAt: string;
  updatedBy: "manual-review";
};

function cloneExperience(experience: ResumeExperience): ResumeExperience {
  return { ...experience };
}

function cloneSocial(record: SocialRecord): SocialRecord {
  return { ...record, paidMonths: [...record.paidMonths] };
}

export function applyFieldOverrides(input: {
  experiences: ResumeExperience[];
  socialRecords: SocialRecord[];
  overrides: FieldOverride[];
}): { experiences: ResumeExperience[]; socialRecords: SocialRecord[] } {
  const experiences = input.experiences.map(cloneExperience);
  const socialRecords = input.socialRecords.map(cloneSocial);
  const resumeById = new Map(
    experiences
      .filter((item) => item.sourceId)
      .map((item) => [item.sourceId as string, item]),
  );
  const socialById = new Map(
    socialRecords
      .filter((item) => item.sourceId)
      .map((item) => [item.sourceId as string, item]),
  );
  for (const override of input.overrides) {
    if (override.reviewStatus !== "applied") continue;
    const resume =
      (override.targetId ? resumeById.get(override.targetId) : undefined) ??
      experiences[override.rowIndex];
    const social =
      (override.targetId ? socialById.get(override.targetId) : undefined) ??
      socialRecords[override.rowIndex];
    if (override.field === "resumeCompany" && resume) {
      resume.companyRaw = override.overrideValue;
    }
    if (override.field === "position" && resume) {
      resume.position = override.overrideValue;
    }
    if (
      (override.field === "startMonth" || override.field === "resumeStartMonth") &&
      resume
    ) {
      resume.startMonth = override.overrideValue;
    }
    if (
      (override.field === "endMonth" || override.field === "resumeEndMonth") &&
      resume
    ) {
      resume.endMonth = override.overrideValue;
      resume.endIsPresent = false;
    }
    if (override.field === "socialStartMonth" && social) {
      social.startMonth = override.overrideValue;
    }
    if (override.field === "socialEndMonth" && social) {
      social.endMonth = override.overrideValue;
    }
    if (override.field === "socialCompany" && social) {
      social.companyRaw = override.overrideValue;
    }
    if (override.field === "unitCompany" && social) {
      social.companyRaw = override.overrideValue;
      social.mappingStatus = override.overrideValue ? "mapped" : "missing";
    }
    if (override.field === "paymentType" && social) {
      const value = override.overrideValue;
      if (value === "company" || value === "personal" || value === "unknown") {
        social.paymentType = value;
      }
    }
  }
  return { experiences, socialRecords };
}

export function upsertOverride(
  current: FieldOverride[],
  next: Omit<FieldOverride, "updatedBy" | "reviewStatus" | "updatedAt"> & {
    reviewStatus?: FieldOverride["reviewStatus"];
  },
): FieldOverride[] {
  const item: FieldOverride = {
    ...next,
    reviewStatus: next.reviewStatus ?? "applied",
    updatedAt: new Date().toISOString(),
    updatedBy: "manual-review",
  };
  return [...current.filter((entry) => entry.id !== item.id), item];
}

export function isResumeOverrideField(field: OverrideField) {
  return (
    field === "resumeCompany" ||
    field === "position" ||
    field === "startMonth" ||
    field === "endMonth" ||
    field === "resumeStartMonth" ||
    field === "resumeEndMonth"
  );
}

export function revertOverride(current: FieldOverride[], id: string): FieldOverride[] {
  return current.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          reviewStatus: "reverted",
          updatedAt: new Date().toISOString(),
          updatedBy: "manual-review",
        }
      : entry,
  );
}
