import type { ExportOutput } from "./sink";

export const EXPORT_MIME_TYPE = "video/mp4";
export const EXPORT_FILE_EXTENSION = ".mp4";

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;

export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];

export interface ExportResult {
	success: boolean;
	output?: ExportOutput;
	error?: string;
	cancelled?: boolean;
}

export interface ExportState {
	isExporting: boolean;
	progress: number;
	result: ExportResult | null;
}

export function downloadBuffer({
	buffer,
	filename,
	mimeType,
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
}): void {
	const blob = new Blob([buffer], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const downloadLink = document.createElement("a");
	downloadLink.href = url;
	downloadLink.download = filename;
	document.body.appendChild(downloadLink);
	downloadLink.click();
	document.body.removeChild(downloadLink);
	URL.revokeObjectURL(url);
}
