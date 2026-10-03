export const LINKED_FILES_TIMEOUT_MS = 10_000;

export type LinkedFileResult =
	| { status: "ok"; file: File }
	| { status: "missing" }
	| { status: "error"; message: string };

export interface HostMessage {
	data: unknown;
	additionalObjects: readonly unknown[];
}

export interface LinkedFilesTransport {
	postWithObjects({
		message,
		objects,
	}: {
		message: string;
		objects: File[];
	}): void;
	invoke({
		command,
		args,
	}: {
		command: string;
		args: Record<string, unknown>;
	}): Promise<unknown>;
	onMessage({ listener }: { listener: (message: HostMessage) => void }): void;
}

interface HostReply {
	type?: unknown;
	requestId?: unknown;
	paths?: unknown;
	status?: unknown;
	message?: unknown;
}

const REPLY_TYPES = new Set(["rcut:resolved-paths", "rcut:linked-file"]);

export function createLinkedFilesBridge({
	transport,
	timeoutMs = LINKED_FILES_TIMEOUT_MS,
	createRequestId = () => crypto.randomUUID(),
}: {
	transport: LinkedFilesTransport;
	timeoutMs?: number;
	createRequestId?: () => string;
}) {
	const pending = new Map<string, (message: HostMessage) => void>();

	transport.onMessage({
		listener: (message) => {
			const reply = message.data as HostReply | null;
			if (!reply || typeof reply.requestId !== "string") return;
			if (typeof reply.type !== "string" || !REPLY_TYPES.has(reply.type)) {
				return;
			}

			const resolve = pending.get(reply.requestId);
			if (!resolve) return;
			pending.delete(reply.requestId);
			resolve(message);
		},
	});

	function request({
		send,
	}: {
		send: (requestId: string) => unknown;
	}): Promise<HostMessage | null> {
		const requestId = createRequestId();

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve(null);
			}, timeoutMs);

			const fail = () => {
				clearTimeout(timer);
				pending.delete(requestId);
				resolve(null);
			};

			pending.set(requestId, (message) => {
				clearTimeout(timer);
				resolve(message);
			});

			try {
				Promise.resolve(send(requestId)).catch(fail);
			} catch {
				fail();
			}
		});
	}

	async function resolveFilePaths({
		files,
	}: {
		files: File[];
	}): Promise<(string | null)[]> {
		if (files.length === 0) return [];

		const response = await request({
			send: (requestId) =>
				transport.postWithObjects({
					message: JSON.stringify({ type: "rcut:resolve-paths", requestId }),
					objects: files,
				}),
		});

		const paths = (response?.data as HostReply | undefined)?.paths;
		return files.map((_, index) => {
			const path = Array.isArray(paths) ? paths[index] : null;
			return typeof path === "string" && path.length > 0 ? path : null;
		});
	}

	async function openLinkedFile({
		path,
	}: {
		path: string;
	}): Promise<LinkedFileResult> {
		const response = await request({
			send: (requestId) =>
				transport.invoke({
					command: "open_linked_file",
					args: { requestId, path },
				}),
		});

		if (!response) {
			return {
				status: "error",
				message: "Linked file request failed or timed out",
			};
		}

		const reply = response.data as HostReply;
		if (reply.status === "missing") return { status: "missing" };

		if (reply.status === "ok") {
			const handle = response.additionalObjects[0] as
				| { getFile?: () => Promise<File> }
				| undefined;
			if (!handle?.getFile) {
				return { status: "error", message: "No file handle received" };
			}

			try {
				return { status: "ok", file: await handle.getFile() };
			} catch (error) {
				return {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}

		return {
			status: "error",
			message:
				typeof reply.message === "string"
					? reply.message
					: "Failed to open linked file",
		};
	}

	return { resolveFilePaths, openLinkedFile };
}
