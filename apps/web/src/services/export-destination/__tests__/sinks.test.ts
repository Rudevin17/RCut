import { describe, expect, test } from "bun:test";
import type { InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";
import type { StreamTargetChunk } from "mediabunny";
import {
	createDiskSink,
	createStreamWritable,
	type Invoke,
} from "@/services/export-destination/sinks";

type Call = { cmd: string; args: unknown; options: unknown };

function fakeInvoke({
	results = {},
}: {
	results?: Record<string, () => Promise<unknown>>;
} = {}) {
	const calls: Call[] = [];
	/* eslint-disable rcut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- mirrors Tauri's positional, generic invoke */
	const invoke = async <T,>(
		cmd: string,
		args?: InvokeArgs,
		options?: InvokeOptions,
	): Promise<T> => {
		calls.push({ cmd, args, options });
		const result = results[cmd];
		return (result ? await result() : undefined) as T;
	};
	/* eslint-enable rcut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion */
	return { calls, invoke: invoke satisfies Invoke };
}

function chunk({ position, bytes }: { position: number; bytes: number }): StreamTargetChunk {
	return { type: "write", data: new Uint8Array(bytes), position };
}

describe("createDiskSink", () => {
	test("open sends the folder and file-name headers and streams without fast start", async () => {
		const { calls, invoke } = fakeInvoke({
			results: { export_stream_open: async () => 7 },
		});
		const sink = createDiskSink({
			destination: { kind: "folder", folder: "C:\\Videos\\My clips", fileName: "Café #1.mp4" },
			invoke,
		});

		const attempt = await sink.open();

		expect(calls).toEqual([
			{
				cmd: "export_stream_open",
				args: undefined,
				options: {
					headers: {
						"x-rcut-folder": encodeURIComponent("C:\\Videos\\My clips"),
						"x-rcut-file-name": encodeURIComponent("Café #1.mp4"),
					},
				},
			},
		]);
		expect(attempt.fastStart).toBe(false);
		expect(attempt.target).toBeDefined();
	});

	test("open sends the path header for a chosen file", async () => {
		const { calls, invoke } = fakeInvoke({
			results: { export_stream_open: async () => 1 },
		});
		const sink = createDiskSink({
			destination: { kind: "file", path: "D:\\out\\a b.mp4" },
			invoke,
		});

		await sink.open();

		expect(calls[0].options).toEqual({
			headers: { "x-rcut-path": encodeURIComponent("D:\\out\\a b.mp4") },
		});
	});

	test("commit returns the path from export_stream_finish", async () => {
		const { calls, invoke } = fakeInvoke({
			results: {
				export_stream_open: async () => 3,
				export_stream_finish: async () => "C:\\Videos\\clip.mp4",
			},
		});
		const attempt = await createDiskSink({
			destination: { kind: "file", path: "C:\\Videos\\clip.mp4" },
			invoke,
		}).open();

		const output = await attempt.commit();

		expect(output).toEqual({ kind: "file", path: "C:\\Videos\\clip.mp4" });
		expect(calls[1]).toEqual({
			cmd: "export_stream_finish",
			args: { id: 3 },
			options: undefined,
		});
	});

	test("abort calls export_stream_abort and swallows a rejection", async () => {
		const { calls, invoke } = fakeInvoke({
			results: {
				export_stream_open: async () => 5,
				export_stream_abort: async () => {
					throw new Error("gone");
				},
			},
		});
		const attempt = await createDiskSink({
			destination: { kind: "file", path: "C:\\x.mp4" },
			invoke,
		}).open();

		await expect(attempt.abort()).resolves.toBeUndefined();
		expect(calls[1]).toEqual({
			cmd: "export_stream_abort",
			args: { id: 5 },
			options: undefined,
		});
	});
});

describe("createStreamWritable", () => {
	test("writes chunks in order with stream id and position headers", async () => {
		const { calls, invoke } = fakeInvoke();
		const writable = createStreamWritable({ id: 9, invoke });
		const writer = writable.getWriter();
		const first = chunk({ position: 0, bytes: 16 });
		const second = chunk({ position: 16, bytes: 8 });

		await writer.write(first);
		await writer.write(second);
		await writer.close();

		expect(calls).toEqual([
			{
				cmd: "export_stream_write",
				args: first.data,
				options: { headers: { "x-rcut-stream-id": "9", "x-rcut-position": "0" } },
			},
			{
				cmd: "export_stream_write",
				args: second.data,
				options: { headers: { "x-rcut-stream-id": "9", "x-rcut-position": "16" } },
			},
		]);
	});
});
