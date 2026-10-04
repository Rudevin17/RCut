import type { Target } from "mediabunny";

/** Where a finished export ended up. */
export type ExportOutput =
	| { kind: "file"; path: string }
	| { kind: "buffer"; buffer: ArrayBuffer };

/** One encode attempt's destination. */
export interface ExportSinkAttempt {
	target: Target;
	/** MP4 Fast Start mode for this target. */
	fastStart: false | "in-memory";
	/** Call after output.finalize() succeeds. */
	commit(): Promise<ExportOutput>;
	/** Call when the attempt fails or is cancelled; removes anything written. Never throws. */
	abort(): Promise<void>;
}

export interface ExportSink {
	/** Opens a fresh destination for one encode attempt. */
	open(): Promise<ExportSinkAttempt>;
}
