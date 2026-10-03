import { describe, expect, test } from "bun:test";
import {
	createLinkedFilesBridge,
	type HostMessage,
	type LinkedFilesTransport,
} from "@/services/linked-files/bridge";

function createFakeTransport() {
	let listener: ((message: HostMessage) => void) | null = null;
	const posted: Array<{ message: string; objects: File[] }> = [];
	const invoked: Array<{ command: string; args: Record<string, unknown> }> = [];
	let invokeImpl: () => Promise<unknown> = async () => undefined;

	const transport: LinkedFilesTransport = {
		postWithObjects: ({ message, objects }) => {
			posted.push({ message, objects });
		},
		invoke: ({ command, args }) => {
			invoked.push({ command, args });
			return invokeImpl();
		},
		onMessage: ({ listener: next }) => {
			listener = next;
		},
	};

	return {
		transport,
		posted,
		invoked,
		reply: (message: HostMessage) => listener?.(message),
		failInvoke: () => {
			invokeImpl = async () => {
				throw new Error("command failed");
			};
		},
	};
}

function createBridge({ timeoutMs = 50 }: { timeoutMs?: number } = {}) {
	const fake = createFakeTransport();
	let counter = 0;
	const bridge = createLinkedFilesBridge({
		transport: fake.transport,
		timeoutMs,
		createRequestId: () => `req-${++counter}`,
	});
	return { fake, bridge };
}

const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

describe("resolveFilePaths", () => {
	test("posts the files and maps returned paths by index", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.resolveFilePaths({ files: [fileA, fileB] });

		expect(JSON.parse(fake.posted[0].message)).toEqual({
			type: "rcut:resolve-paths",
			requestId: "req-1",
		});
		expect(fake.posted[0].objects).toEqual([fileA, fileB]);

		fake.reply({
			data: {
				type: "rcut:resolved-paths",
				requestId: "req-1",
				paths: ["D:\\a.mp4", null],
			},
			additionalObjects: [],
		});

		expect(await pending).toEqual(["D:\\a.mp4", null]);
	});

	test("returns nulls on timeout", async () => {
		const { bridge } = createBridge({ timeoutMs: 10 });
		expect(await bridge.resolveFilePaths({ files: [fileA] })).toEqual([null]);
	});

	test("returns nulls for missing or malformed paths", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.resolveFilePaths({ files: [fileA, fileB] });
		fake.reply({
			data: { type: "rcut:resolved-paths", requestId: "req-1", paths: [""] },
			additionalObjects: [],
		});
		expect(await pending).toEqual([null, null]);
	});

	test("returns an empty array without posting for no files", async () => {
		const { fake, bridge } = createBridge();
		expect(await bridge.resolveFilePaths({ files: [] })).toEqual([]);
		expect(fake.posted).toHaveLength(0);
	});

	test("ignores messages with another type or unknown request id", async () => {
		const { fake, bridge } = createBridge({ timeoutMs: 20 });
		const pending = bridge.resolveFilePaths({ files: [fileA] });
		fake.reply({
			data: { type: "something-else", requestId: "req-1", paths: ["x"] },
			additionalObjects: [],
		});
		fake.reply({
			data: { type: "rcut:resolved-paths", requestId: "req-99", paths: ["x"] },
			additionalObjects: [],
		});
		expect(await pending).toEqual([null]);
	});
});

describe("openLinkedFile", () => {
	test("invokes the command and returns the file from the handle", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });

		expect(fake.invoked[0]).toEqual({
			command: "open_linked_file",
			args: { requestId: "req-1", path: "D:\\a.mp4" },
		});

		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "ok" },
			additionalObjects: [{ getFile: async () => fileA }],
		});

		expect(await pending).toEqual({ status: "ok", file: fileA });
	});

	test("reports missing files", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\gone.mp4" });
		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "missing" },
			additionalObjects: [],
		});
		expect(await pending).toEqual({ status: "missing" });
	});

	test("reports host errors with their message", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });
		fake.reply({
			data: {
				type: "rcut:linked-file",
				requestId: "req-1",
				status: "error",
				message: "no Environment14",
			},
			additionalObjects: [],
		});
		expect(await pending).toEqual({
			status: "error",
			message: "no Environment14",
		});
	});

	test("reports an error when ok arrives without a handle", async () => {
		const { fake, bridge } = createBridge();
		const pending = bridge.openLinkedFile({ path: "D:\\a.mp4" });
		fake.reply({
			data: { type: "rcut:linked-file", requestId: "req-1", status: "ok" },
			additionalObjects: [],
		});
		expect((await pending).status).toBe("error");
	});

	test("reports an error when the command fails", async () => {
		const { fake, bridge } = createBridge();
		fake.failInvoke();
		expect((await bridge.openLinkedFile({ path: "D:\\a.mp4" })).status).toBe(
			"error",
		);
	});

	test("reports an error on timeout", async () => {
		const { bridge } = createBridge({ timeoutMs: 10 });
		expect((await bridge.openLinkedFile({ path: "D:\\a.mp4" })).status).toBe(
			"error",
		);
	});
});
