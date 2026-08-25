import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import {
  DOCUMENT_EXTRACTION_VERSION,
  EVIDENCE_TASK_SCHEMA_VERSION,
} from "./document-extraction";
import type {
  EvidenceIssue,
  EvidenceValidationResult,
  EvidenceValidationStatus,
} from "./evidence-validator";
import type {
  EvidenceMonthField,
  EvidenceMonthsField,
  EvidenceNumberField,
  EvidenceStringField,
  ResumeEvidenceExtraction,
  SocialSecurityEvidenceRecord,
} from "./schemas";
import {
  readVersionedStageArtifact,
  resolveVersionedStageArtifact,
  writeVersionedStageArtifact,
  type PipelineArtifactVersions,
  type ProcessingStage,
} from "./stage-cache";
import {
  EVIDENCE_VALIDATOR_VERSION,
  EVIDENCE_PIPELINE_STAGE_ORDER,
  PARSER_VERSION,
  VERIFICATION_ENGINE_VERSION,
  createEvidenceValidationStage,
  runIntegratedVerification,
  verificationResultForStorage,
  type DerivedFactsPayload,
  type EvidenceValidationStagePayload,
} from "./worker-pipeline-integration";
import {
  PIPELINE_VERSIONS,
  isEvidencePipelineTask,
} from "./worker";

const SYNTHETIC_FIXTURE = true;
const taskIds: string[] = [];
const versions: PipelineArtifactVersions = {
  taskSchemaVersion: EVIDENCE_TASK_SCHEMA_VERSION,
  extractionVersion: DOCUMENT_EXTRACTION_VERSION,
  ocrVersion: "synthetic-ocr-v1",
  parserVersion: PARSER_VERSION,
  evidenceValidatorVersion: EVIDENCE_VALIDATOR_VERSION,
  verificationEngineVersion: VERIFICATION_ENGINE_VERSION,
};

const base = {
  status: "verified" as const,
  sourceFile: "synthetic.pdf",
  sourcePage: 1,
  sourceQuote: "甲公司 2022-03 2022-04",
  extractionMethod: "table_ocr" as const,
  confidence: 0.99,
};
const text = (value: string): EvidenceStringField => ({ ...base, value });
const month = (value: string): EvidenceMonthField => ({ ...base, value });
const months = (value: string[]): EvidenceMonthsField => ({ ...base, value });
const count = (value: number): EvidenceNumberField => ({ ...base, value });

function resumeEvidence(): ResumeEvidenceExtraction {
  return {
    candidateName: {
      ...text("候选人"),
      sourceQuote: "候选人",
      extractionMethod: "deepseek",
    },
    experiences: [
      {
        resumeCompany: {
          ...text("甲公司"),
          extractionMethod: "deepseek",
        },
        resumeStartMonth: {
          ...month("2022-03"),
          extractionMethod: "deepseek",
        },
        resumeEndMonth: {
          ...month("2022-04"),
          extractionMethod: "deepseek",
        },
        warnings: [],
      },
    ],
  };
}

function socialEvidence(): SocialSecurityEvidenceRecord[] {
  return [
    {
      companyRaw: text("甲公司"),
      companyNormalized: "甲",
      startMonth: month("2022-03"),
      endMonth: month("2022-04"),
      paidMonths: months(["2022-03", "2022-04"]),
      pensionMonths: count(2),
      injuryMonths: count(2),
      unemploymentMonths: count(2),
      personalInsurance: false,
      sourceFile: "synthetic.pdf",
      sourcePage: 1,
      sourceEvidence: ["synthetic-cell-month-1", "synthetic-cell-month-2"],
      template: "shenzhen",
      warnings: [],
    },
  ];
}

function validationResult<T>(
  value: T,
  status: EvidenceValidationStatus = "VALIDATED",
  issues: EvidenceIssue[] = [],
): EvidenceValidationResult<T> {
  return {
    value,
    issues,
    valid: status === "VALIDATED",
    validationStatus: status,
    automaticEligible: status === "VALIDATED",
  };
}

function validationStage(input?: {
  resumeStatus?: EvidenceValidationStatus;
  socialStatus?: EvidenceValidationStatus;
  resume?: ResumeEvidenceExtraction;
  social?: SocialSecurityEvidenceRecord[];
}): EvidenceValidationStagePayload {
  return createEvidenceValidationStage({
    versions,
    resumeValidation: validationResult(
      input?.resume ?? resumeEvidence(),
      input?.resumeStatus,
    ),
    socialValidation: validationResult(
      input?.social ?? socialEvidence(),
      input?.socialStatus,
    ),
    upstreamIssues: [],
  });
}

function createTask() {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO verification_tasks
      (id, status, stage, task_schema_version, extraction_version,
       created_at, updated_at)
     VALUES (?, 'PROCESSING', 'STRUCTURED', ?, ?, ?, ?)`,
  ).run(
    id,
    EVIDENCE_TASK_SCHEMA_VERSION,
    DOCUMENT_EXTRACTION_VERSION,
    now,
    now,
  );
  taskIds.push(id);
  return id;
}

afterEach(() => {
  for (const id of taskIds.splice(0)) {
    db.prepare("DELETE FROM verification_tasks WHERE id = ?").run(id);
  }
});

describe("[synthetic] Phase 8.5 Worker pipeline integration", () => {
  it("[synthetic] enforces the fixed evidence pipeline stage order", () => {
    expect(EVIDENCE_PIPELINE_STAGE_ORDER).toEqual([
      "DOCUMENT_INGESTED",
      "EXTRACTION_COMPLETE",
      "OCR_COMPLETE",
      "STRUCTURED",
      "EVIDENCE_VALIDATED",
      "VERIFICATION_COMPLETE",
    ]);
  });

  it("[synthetic] A: executes verification for a complete VALIDATED pipeline", () => {
    expect(SYNTHETIC_FIXTURE).toBe(true);
    const result = runIntegratedVerification({
      validationStage: validationStage(),
    });
    expect(result.verificationInvoked).toBe(true);
    expect(result.verificationResult).toMatchObject({
      conclusion: "CONSISTENT",
      items: [
        expect.objectContaining({
          matchStatus: "EXACT_MATCH",
          companyMatchType: "EXACT",
        }),
      ],
    });
    expect(result.derivedFacts?.socialSecurity[0]).toMatchObject({
      companyRaw: "甲公司",
      companyRawSource: "VALIDATED_RAW_EVIDENCE",
      paidMonths: ["2022-03", "2022-04"],
      paidMonthsSource: "VALIDATED_MONTHLY_EVIDENCE",
    });
    const stored = verificationResultForStorage(result.verificationResult);
    expect(stored.items[0]).not.toHaveProperty("resume");
    expect(stored.items[0]).not.toHaveProperty("socialSecurity");
    expect(stored.items[0].evidenceRefs.length).toBeGreaterThan(0);
  });

  it("[synthetic] keeps a social extraction failure scoped away from resume fields", () => {
    const stage = createEvidenceValidationStage({
      versions,
      resumeValidation: validationResult(resumeEvidence()),
      socialValidation: validationResult(socialEvidence(), "UNSUPPORTED"),
      upstreamIssues: [
        {
          code: "EXTRACTION_UNSUPPORTED",
          field: "socialSecurityStructure",
          sourceFile: "social.pdf",
          sourcePage: 1,
          message: "社保字段无法定位",
        },
      ],
    });

    expect(stage.resume.validationStatus).toBe("VALIDATED");
    expect(stage.socialSecurity.validationStatus).toBe("UNSUPPORTED");
  });

  it("[synthetic] B: does not invoke verification for unvalidated resume evidence", () => {
    const verify = vi.fn();
    const result = runIntegratedVerification({
      validationStage: validationStage({ resumeStatus: "UNCERTAIN" }),
      verify,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      verificationInvoked: false,
      verificationResult: { conclusion: "INSUFFICIENT_EVIDENCE" },
    });
  });

  it("[synthetic] C: forces manual review for conflicting social evidence", () => {
    const verify = vi.fn();
    const result = runIntegratedVerification({
      validationStage: validationStage({ socialStatus: "CONFLICT" }),
      verify,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(result.verificationResult.conclusion).toBe(
      "MANUAL_REVIEW_REQUIRED",
    );
  });

  it("[synthetic] D: fails closed when the Evidence Validator stage is missing", () => {
    const verify = vi.fn();
    const result = runIntegratedVerification({
      validationStage: null,
      verify,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(result.verificationResult).toMatchObject({
      conclusion: "INSUFFICIENT_EVIDENCE",
      items: [
        expect.objectContaining({
          warnings: ["EVIDENCE_STAGE_MISSING"],
        }),
      ],
    });
  });

  it("[synthetic] E/F: strictly isolates legacy and evidence-pipeline tasks", () => {
    expect(
      isEvidencePipelineTask({
        task_schema_version: 1,
        extraction_version: null,
      }),
    ).toBe(false);
    expect(
      isEvidencePipelineTask({
        task_schema_version: EVIDENCE_TASK_SCHEMA_VERSION + 1,
        extraction_version: DOCUMENT_EXTRACTION_VERSION,
      }),
    ).toBe(false);
    expect(
      isEvidencePipelineTask({
        task_schema_version: PIPELINE_VERSIONS.taskSchemaVersion,
        extraction_version: PIPELINE_VERSIONS.extractionVersion,
      }),
    ).toBe(true);
  });

  it("[synthetic] G: rejects paidMonths attributed to old DeepSeek JSON", () => {
    const social = socialEvidence();
    social[0].paidMonths.extractionMethod = "deepseek";
    const verify = vi.fn();
    expect(() =>
      runIntegratedVerification({
        validationStage: validationStage({ social }),
        verify,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VERIFICATION_INPUT_INVALID",
      }),
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it("[synthetic] H: normalized company cannot replace unvalidated companyRaw", () => {
    const social = socialEvidence();
    social[0].companyNormalized = "甲公司";
    social[0].companyRaw.status = "uncertain";
    const verify = vi.fn();
    expect(() =>
      runIntegratedVerification({
        validationStage: validationStage({ social }),
        verify,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VERIFICATION_INPUT_INVALID",
      }),
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it("[synthetic] I: rejects a cached Validator artifact with a version mismatch", () => {
    const taskId = createTask();
    const cacheKey = "synthetic-version-key";
    writeVersionedStageArtifact({
      taskId,
      stage: "EVIDENCE_VALIDATED",
      cacheKey,
      versions,
      payload: validationStage(),
    });
    expect(
      readVersionedStageArtifact({
        taskId,
        stage: "EVIDENCE_VALIDATED",
        cacheKey,
        versions: {
          ...versions,
          evidenceValidatorVersion: "different-validator-version",
        },
      }),
    ).toBeNull();
  });

  it("[synthetic] J: retry reuses compatible OCR, Parser, and Validator stages", async () => {
    const taskId = createTask();
    const stages: ProcessingStage[] = [
      "OCR_COMPLETE",
      "STRUCTURED",
      "EVIDENCE_VALIDATED",
    ];
    const producers = stages.map(() => vi.fn(async () => ({ synthetic: true })));
    for (const [index, stage] of stages.entries()) {
      const input = {
        taskId,
        stage,
        cacheKey: `synthetic-retry-${stage}`,
        versions,
        produce: producers[index],
      };
      expect((await resolveVersionedStageArtifact(input)).cacheHit).toBe(false);
      expect((await resolveVersionedStageArtifact(input)).cacheHit).toBe(true);
    }
    expect(producers.every((producer) => producer.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("[synthetic] K: Engine failure preserves validated evidence and derived facts", () => {
    const stage = validationStage();
    let persistedDerived: DerivedFactsPayload | undefined;
    expect(() =>
      runIntegratedVerification({
        validationStage: stage,
        onDerivedFacts: (facts) => {
          persistedDerived = facts;
        },
        verify: () => {
          throw new Error("synthetic engine failure");
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "VERIFICATION_FAILED",
      }),
    );
    expect(stage.validationStatus).toBe("VALIDATED");
    expect(persistedDerived?.socialSecurity[0].paidMonthsSource).toBe(
      "VALIDATED_MONTHLY_EVIDENCE",
    );
  });
});
