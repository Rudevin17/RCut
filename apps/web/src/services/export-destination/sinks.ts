import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { BufferTarget, StreamTarget, type StreamTargetChunk } from "mediabunny";
import type { ExportSink } from "@/export/sink";

/** The Tauri `invoke` function; injectable so tests can pass a fake. */
export type Invoke = typeof tauriInvoke;

export type DiskDestination =
	| { kind: "folder"; folder: string; fileName: string }
	| { kind: "file"; path: string };

/** Keeps the whole export in memory, for the browser download. */
export function createBufferSink(): ExportSink {
	return {
		async open() {
			const target = new BufferTarget();
			return {
				target,
				fastStart: "in-memory",
				async commit() {
					if (!target.buffer) throw new Error("Export produced no data");
					return { kind: "buffer", buffer: target.buffer };
				},
				async abort() {},
			};
		},
	};
}

/** Sends each chunk mediabunny writes to the native export stream `id`, at its byte position. */
export function createStreamWritable({
	id,
	invoke,
}: {
	id: number;
	invoke: Invoke;
}): WritableStream<StreamTargetChunk> {
	return new WritableStream<StreamTargetChunk>({
		write: async (chunk) => {
			await invoke("export_stream_write", chunk.data, {
				headers: {
					"x-rcut-stream-id": String(id),
					"x-rcut-position": String(chunk.position),
				},
			});
		},
	});
}

/** Streams the export straight into a native `.part` file that is renamed on commit. */
export function createDiskSink({
	destination,
	invoke = tauriInvoke,
}: {
	destination: DiskDestination;
	invoke?: Invoke;
}): ExportSink {
	const headers: Record<string, string> =
		destination.kind === "folder"
			? {
					"x-rcut-folder": encodeURIComponent(destination.folder),
					"x-rcut-file-name": encodeURIComponent(destination.fileName),
				}
			: { "x-rcut-path": encodeURIComponent(destination.path) };

	return {
		async open() {
			const id = await invoke<number>("export_stream_open", undefined, { headers });
			const target = new StreamTarget(createStreamWritable({ id, invoke }), {
				chunked: true,
			});
			return {
				target,
				fastStart: false,
				async commit() {
					const path = await invoke<string>("export_stream_finish", { id });
					return { kind: "file", path };
				},
				async abort() {
					await invoke("export_stream_abort", { id }).catch(() => {});
				},
			};
		},
	};
}
