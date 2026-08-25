import type {
  EvidenceIssue,
  EvidenceValidationResult,
  EvidenceValidationStatus,
} from "./evidence-validator";
import type {
  ResumeEvidenceExtraction,
  SocialSecurityEvidenceRecord,
} from "./schemas";
import {
  verifyValidatedEvidence,
  type Phase8VerificationInput,
  type Phase8VerificationResult,
  type VerificationV2Item,
} from "./verification-engine-phase8";
import type { PipelineArtifactVersions } from "./stage-cache";

export const PARSER_VERSION = "social-security-generic-parser-v3";
export const EVIDENCE_VALIDATOR_VERSION = "evidence-validator-phase7-v2";
export const VERIFICATION_ENGINE_VERSION = "verification-engine-phase8-v1";
export const EVIDENCE_PIPELINE_STAGE_ORDER = [
  "DOCUMENT_INGESTED",
  "EXTRACTION_COMPLETE",
  "OCR_COMPLETE",
  "STRUCTURED",
  "EVIDENCE_VALIDATED",
  "VERIFICATION_COMPLETE",
] as const;

export type PipelineIntegrationErrorCode =
  | "EVIDENCE_STAGE_MISSING"
  | "EVIDENCE_VALIDATION_FAILED"
  | "EVIDENCE_VERSION_MISMATCH"
  | "VERIFICATION_INPUT_INVALID"
  | "VERIFICATION_FAILED";

export class PipelineIntegrationError extends Error {
  constructor(
    public readonly code: PipelineIntegrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PipelineIntegrationError";
  }
}

export type EvidenceValidationStagePayload = {
  versions: PipelineArtifactVersions;
  validationStatus: EvidenceValidationStatus;
  resume: {
    validationStatus: EvidenceValidationStatus;
    evidence: ResumeEvidenceExtraction;
  };
  socialSecurity: {
    validationStatus: EvidenceValidationStatus;
    evidence: SocialSecurityEvidenceRecord[];
  };
  issues: EvidenceIssue[];
  evidenceCount: number;
};

export type ValidatedResumeEvidence = {
  validationStatus: "VALIDATED";
  evidence: ResumeEvidenceExtraction;
};

export type ValidatedSocialSecurityEvidence = {
  validationStatus: "VALIDATED";
  evidence: SocialSecurityEvidenceRecord[];
};

export type ValidatedEvidenceSet = {
  versions: PipelineArtifactVersions;
  resume: ValidatedResumeEvidence;
  socialSecurity: ValidatedSocialSecurityEvidence;
  evidenceCount: number;
};

export type DerivedSocialSecurityFact = {
  companyRaw: string;
  companyRawSource: "VALIDATED_RAW_EVIDENCE";
  companyEvidenceRefs: string[];
  startMonth: string;
  endMonth: string;
  paidMonths: string[];
  paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE";
  paidMonthsEvidenceRefs: string[];
};

export type DerivedFactsPayload = {
  versions: PipelineArtifactVersions;
  socialSecurity: DerivedSocialSecurityFact[];
};

function issueStatus(issues: EvidenceIssue[]): EvidenceValidationStatus | null {
  if (!issues.length) return null;
  if (
    issues.some((issue) =>
      [
        "EVIDENCE_MISMATCH",
        "EXTRACTION_CONFLICT",
        "CELL_EVIDENCE_MISMATCH",
        "DERIVATION_MISMATCH",
      ].includes(issue.code),
    )
  ) {
    return "CONFLICT";
  }
  if (
    issues.some((issue) =>
      [
        "EXTRACTION_UNSUPPORTED",
        "TRANSFORMATION_UNSUPPORTED",
        "MONTH_DETAIL_UNAVAILABLE",
        "CELL_EVIDENCE_MISSING",
        "SOURCE_QUOTE_MISSING",
      ].includes(issue.code),
    )
  ) {
    return "UNSUPPORTED";
  }
  return "UNCERTAIN";
}

function countEvidence(
  resume: ResumeEvidenceExtraction,
  social: SocialSecurityEvidenceRecord[],
) {
  return (
    1 +
    resume.experiences.length * 4 +
    social.length * 5
  );
}

export function createEvidenceValidationStage(input: {
  versions: PipelineArtifactVersions;
  resumeValidation: EvidenceValidationResult<ResumeEvidenceExtraction>;
  socialValidation: EvidenceValidationResult<SocialSecurityEvidenceRecord[]>;
  upstreamIssues: EvidenceIssue[];
}): EvidenceValidationStagePayload {
  const resumeUpstreamIssues = input.upstreamIssues.filter(
    (issue) =>
      issue.field === "candidateName" ||
      /^(?:resume|experiences)\./u.test(issue.field),
  );
  const socialUpstreamIssues = input.upstreamIssues.filter((issue) =>
    /^(?:records\.|social(?:\.|Security))/u.test(issue.field),
  );
  const unscopedIssues = input.upstreamIssues.filter(
    (issue) =>
      !resumeUpstreamIssues.includes(issue) &&
      !socialUpstreamIssues.includes(issue),
  );
  const resumeStatus =
    issueStatus([...unscopedIssues, ...resumeUpstreamIssues]) ??
    input.resumeValidation.validationStatus;
  const socialStatus =
    issueStatus([...unscopedIssues, ...socialUpstreamIssues]) ??
    input.socialValidation.validationStatus;
  const statuses = [resumeStatus, socialStatus];
  const validationStatus = statuses.includes("CONFLICT")
    ? "CONFLICT"
    : statuses.includes("UNSUPPORTED")
      ? "UNSUPPORTED"
      : statuses.includes("UNCERTAIN")
        ? "UNCERTAIN"
        : "VALIDATED";
  const issues = [
    ...input.upstreamIssues,
    ...input.resumeValidation.issues,
    ...input.socialValidation.issues,
  ];
  return {
    versions: input.versions,
    validationStatus,
    resume: {
      validationStatus: resumeStatus,
      evidence: input.resumeValidation.value,
    },
    socialSecurity: {
      validationStatus: socialStatus,
      evidence: input.socialValidation.value,
    },
    issues,
    evidenceCount: countEvidence(
      input.resumeValidation.value,
      input.socialValidation.value,
    ),
  };
}

export function validatedEvidenceSet(
  stage: EvidenceValidationStagePayload | null,
): ValidatedEvidenceSet | null {
  if (
    !stage ||
    stage.validationStatus !== "VALIDATED" ||
    stage.resume.validationStatus !== "VALIDATED" ||
    stage.socialSecurity.validationStatus !== "VALIDATED" ||
    stage.issues.length
  ) {
    return null;
  }
  return {
    versions: stage.versions,
    resume: {
      validationStatus: "VALIDATED",
      evidence: stage.resume.evidence,
    },
    socialSecurity: {
      validationStatus: "VALIDATED",
      evidence: stage.socialSecurity.evidence,
    },
    evidenceCount: stage.evidenceCount,
  };
}

function assertCompanyRawSource(
  resume: ResumeEvidenceExtraction,
  social: SocialSecurityEvidenceRecord[],
) {
  for (const [index, experience] of resume.experiences.entries()) {
    const field = experience.resumeCompany;
    if (
      field.status !== "verified" ||
      !field.value ||
      !field.sourceQuote.includes(field.value)
    ) {
      throw new PipelineIntegrationError(
        "VERIFICATION_INPUT_INVALID",
        `resume companyRaw ${index} is not validated raw evidence`,
      );
    }
  }
  for (const [index, record] of social.entries()) {
    const field = record.companyRaw;
    if (
      field.status !== "verified" ||
      !field.value ||
      field.extractionMethod !== "table_ocr" ||
      !field.sourceQuote.includes(field.value)
    ) {
      throw new PipelineIntegrationError(
        "VERIFICATION_INPUT_INVALID",
        `social companyRaw ${index} is not validated table evidence`,
      );
    }
  }
}

export function deriveValidatedFacts(
  validated: ValidatedEvidenceSet,
): DerivedFactsPayload {
  const resume = validated.resume.evidence;
  const social = validated.socialSecurity.evidence;
  assertCompanyRawSource(resume, social);
  const socialSecurity = social.map((record, index) => {
    const paidMonths = record.paidMonths;
    if (
      paidMonths.status !== "verified" ||
      paidMonths.value === null ||
      paidMonths.extractionMethod !== "table_ocr" ||
      !paidMonths.sourceQuote ||
      !record.sourceEvidence.length
    ) {
      throw new PipelineIntegrationError(
        "VERIFICATION_INPUT_INVALID",
        `paidMonths ${index} is not VALIDATED_MONTHLY_EVIDENCE`,
      );
    }
    if (
      !record.startMonth.value ||
      !record.endMonth.value ||
      !record.companyRaw.value
    ) {
      throw new PipelineIntegrationError(
        "VERIFICATION_INPUT_INVALID",
        `social record ${index} is missing validated facts`,
      );
    }
    return {
      companyRaw: record.companyRaw.value,
      companyRawSource: "VALIDATED_RAW_EVIDENCE" as const,
      companyEvidenceRefs: [
        `${record.companyRaw.sourceFile}:${record.companyRaw.sourcePage}:${record.companyRaw.sourceQuote}`,
      ],
      startMonth: record.startMonth.value,
      endMonth: record.endMonth.value,
      paidMonths: [...paidMonths.value],
      paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE" as const,
      paidMonthsEvidenceRefs: [
        ...record.sourceEvidence,
        `${paidMonths.sourceFile}:${paidMonths.sourcePage}:${paidMonths.sourceQuote}`,
      ],
    };
  });
  return {
    versions: validated.versions,
    socialSecurity,
  };
}

function blockedItem(
  manual: boolean,
  warning: string,
  description: string,
): VerificationV2Item {
  return {
    matchStatus: manual
      ? "MANUAL_REVIEW_REQUIRED"
      : "INSUFFICIENT_EVIDENCE",
    companyMatchType: null,
    rawResumeCompanyName: null,
    rawSocialSecurityCompanyName: null,
    normalizedCompanyName: null,
    resumePeriod: null,
    socialSecurityPeriod: null,
    paidMonths: [],
    missingMonths: [],
    extraMonths: [],
    gapMonths: [],
    warnings: [warning],
    evidenceRefs: [],
    confidence: 0,
    requiresManualReview: true,
    status: manual ? "MANUAL_REVIEW_REQUIRED" : "EXTRACTION_UNCERTAIN",
    description,
    rules: ["Verification Engine 仅接收显式 VALIDATED Evidence Set"],
  };
}

export function blockedVerificationResult(
  stage: EvidenceValidationStagePayload | null,
): Phase8VerificationResult {
  if (!stage) {
    return {
      conclusion: "INSUFFICIENT_EVIDENCE",
      items: [
        blockedItem(
          false,
          "EVIDENCE_STAGE_MISSING",
          "Evidence Validator stage 缺失，已停止自动核验",
        ),
      ],
    };
  }
  const manual =
    stage.validationStatus === "CONFLICT" ||
    stage.validationStatus === "UNSUPPORTED";
  return {
    conclusion: manual
      ? "MANUAL_REVIEW_REQUIRED"
      : "INSUFFICIENT_EVIDENCE",
    items: [
      blockedItem(
        manual,
        `EVIDENCE_${stage.validationStatus}`,
        `Evidence validation status = ${stage.validationStatus}，已停止自动核验`,
      ),
    ],
  };
}

export function verificationResultForStorage(
  result: Phase8VerificationResult,
): Phase8VerificationResult {
  return {
    conclusion: result.conclusion,
    items: result.items.map((item) => {
      const referenceOnlyItem = { ...item };
      delete referenceOnlyItem.resume;
      delete referenceOnlyItem.socialSecurity;
      return referenceOnlyItem;
    }),
  };
}

export function runIntegratedVerification(input: {
  validationStage: EvidenceValidationStagePayload | null;
  onDerivedFacts?: (facts: DerivedFactsPayload) => void;
  verify?: (
    input: Phase8VerificationInput,
  ) => Phase8VerificationResult;
}): {
  validatedEvidence: ValidatedEvidenceSet | null;
  derivedFacts: DerivedFactsPayload | null;
  verificationResult: Phase8VerificationResult;
  verificationInvoked: boolean;
} {
  const validatedEvidence = validatedEvidenceSet(input.validationStage);
  if (!validatedEvidence) {
    return {
      validatedEvidence: null,
      derivedFacts: null,
      verificationResult: blockedVerificationResult(input.validationStage),
      verificationInvoked: false,
    };
  }
  const derivedFacts = deriveValidatedFacts(validatedEvidence);
  input.onDerivedFacts?.(derivedFacts);
  const verify = input.verify ?? verifyValidatedEvidence;
  try {
    const verificationResult = verify({
      evidenceGate: {
        resume: validatedEvidence.resume.validationStatus,
        socialSecurity:
          validatedEvidence.socialSecurity.validationStatus,
      },
      resumeExperiences:
        validatedEvidence.resume.evidence.experiences,
      socialSecurityRecords:
        validatedEvidence.socialSecurity.evidence,
    });
    return {
      validatedEvidence,
      derivedFacts,
      verificationResult,
      verificationInvoked: true,
    };
  } catch (error) {
    throw new PipelineIntegrationError(
      "VERIFICATION_FAILED",
      error instanceof Error ? error.message : "Verification Engine failed",
    );
  }
}

export function assertPipelineVersions(input: {
  taskSchemaVersion: number;
  extractionVersion: string | null;
  versions: PipelineArtifactVersions;
}) {
  if (
    input.taskSchemaVersion !== input.versions.taskSchemaVersion ||
    input.extractionVersion !== input.versions.extractionVersion
  ) {
    throw new PipelineIntegrationError(
      "EVIDENCE_VERSION_MISMATCH",
      "Task schema/extraction version does not match pipeline",
    );
  }
}
