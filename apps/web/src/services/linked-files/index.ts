import {
	createLinkedFilesBridge,
	type LinkedFileResult,
} from "@/services/linked-files/bridge";

export type { LinkedFileResult } from "@/services/linked-files/bridge";

interface WebViewHost {
	postMessageWithAdditionalObjects?: (
		message: string,
		additionalObjects: unknown[],
	) => void;
	addEventListener: (
		type: "message",
		listener: (event: {
			data: unknown;
			additionalObjects?: readonly unknown[];
		}) => void,
	) => void;
}

interface TauriInternals {
	invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function getHost(): { webview: WebViewHost; tauri: TauriInternals } | null {
	if (typeof window === "undefined") return null;

	const candidate = window as unknown as {
		chrome?: { webview?: WebViewHost };
		__TAURI_INTERNALS__?: TauriInternals;
	};
	const webview = candidate.chrome?.webview;
	const tauri = candidate.__TAURI_INTERNALS__;

	if (!webview?.postMessageWithAdditionalObjects || !tauri) return null;
	return { webview, tauri };
}

let bridge: ReturnType<typeof createLinkedFilesBridge> | null = null;

function getBridge(): ReturnType<typeof createLinkedFilesBridge> | null {
	if (bridge) return bridge;

	const host = getHost();
	if (!host) return null;

	bridge = createLinkedFilesBridge({
		transport: {
			postWithObjects: ({ message, objects }) =>
				host.webview.postMessageWithAdditionalObjects?.(message, objects),
			invoke: ({ command, args }) => host.tauri.invoke(command, args),
			onMessage: ({ listener }) =>
				host.webview.addEventListener("message", (event) =>
					listener({
						data: event.data,
						additionalObjects: event.additionalObjects ?? [],
					}),
				),
		},
	});
	return bridge;
}

export function isLinkingAvailable(): boolean {
	return getHost() !== null;
}

export async function resolveFilePaths({
	files,
}: {
	files: File[];
}): Promise<(string | null)[]> {
	const linkedFiles = getBridge();
	if (!linkedFiles) return files.map(() => null);
	return linkedFiles.resolveFilePaths({ files });
}

export async function openLinkedFile({
	path,
}: {
	path: string;
}): Promise<LinkedFileResult> {
	const linkedFiles = getBridge();
	if (!linkedFiles) {
		return { status: "error", message: "Linking is not available" };
	}
	return linkedFiles.openLinkedFile({ path });
}
