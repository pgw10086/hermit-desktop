/** 单项资格检查的最终状态。 */
export type QualificationOutcome =
  | "qualified"
  | "unavailable"
  | "blocked"
  | "pending";

/** 结果是否可以作为发布资格的精确证据。 */
export type QualificationSemantics = "exact" | "diagnostic";

/** 资格检查所针对的运行对象。 */
export type QualificationSubject =
  | "hermit-packaged-process"
  | "oracle-process"
  | "fixture";

/** 报告详情允许的可序列化值。 */
export type QualificationDetail = string | number | boolean | null;

export interface QualificationResult {
  /** 资格操作名称。 */
  readonly operation: string;
  /** 操作结果状态。 */
  readonly outcome: QualificationOutcome;
  /** 结果的证据语义。 */
  readonly semantics: QualificationSemantics;
  /** 被检查的对象。 */
  readonly subject: QualificationSubject;
  /** 阻塞或不可用时的原因。 */
  readonly reason?: string;
  /** 补充的结构化诊断详情。 */
  readonly details?: Readonly<Record<string, QualificationDetail>>;
}

export interface SmartClipboardPackagedQualificationReport {
  /** 报告 schema 版本。 */
  readonly schemaVersion: 1;
  /** 本次打包运行的 generation 身份。 */
  readonly generation: string;
  /** 实际被检查的可执行文件路径。 */
  readonly executablePath: string;
  /** 按执行顺序排列的资格结果。 */
  readonly results: readonly QualificationResult[];
}
