import { beforeEach, describe, expect, mock, test } from "bun:test";

const FRAME_DURATION = 1 / 120;
let seekCount = 0;

// Fake decoder: each `canvases(start)` call is a seek that restarts decoding.
class FakeCanvasSink {
	async *canvases(start: number) {
		seekCount++;
		let timestamp = Math.floor(start / FRAME_DURATION) * FRAME_DURATION;
		while (true) {
			yield { canvas: {}, timestamp, duration: FRAME_DURATION };
			timestamp += FRAME_DURATION;
		}
	}
}

mock.module("mediabunny", () => ({
	ALL_FORMATS: [],
	BlobSource: class {},
	Input: class {
		async getPrimaryVideoTrack() {
			return { canDecode: async () => true };
		}
		dispose() {}
	},
	CanvasSink: FakeCanvasSink,
}));

const { VideoCache } = await import("@/services/video-cache/service");

const file = new File([], "clip.mp4", { type: "video/mp4" });
// Lets the cache's background prefetch (async generator) settle between frames.
const nextTick = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function playFrames({
	cache,
	from,
	frames,
}: {
	cache: InstanceType<typeof VideoCache>;
	from: number;
	frames: number;
}): Promise<number> {
	let time = from;
	for (let i = 0; i < frames; i++) {
		await cache.getFrameAt({ mediaId: "clip", file, time });
		await nextTick();
		time += FRAME_DURATION;
	}
	return time;
}

describe("VideoCache playback", () => {
	beforeEach(() => {
		seekCount = 0;
	});

	test("does not re-seek when a frame is skipped after more than 2 seconds of playback", async () => {
		const cache = new VideoCache();
		let time = await playFrames({ cache, from: 10, frames: 300 });

		// The renderer falls one frame behind and asks for the frame after next.
		time += FRAME_DURATION;
		await cache.getFrameAt({ mediaId: "clip", file, time });

		expect(seekCount).toBe(1);
	});

	test("still seeks when jumping backwards", async () => {
		const cache = new VideoCache();
		await playFrames({ cache, from: 10, frames: 30 });

		await cache.getFrameAt({ mediaId: "clip", file, time: 2 });

		expect(seekCount).toBe(2);
	});

	test("still seeks when jumping more than 2 seconds ahead", async () => {
		const cache = new VideoCache();
		await playFrames({ cache, from: 10, frames: 30 });

		await cache.getFrameAt({ mediaId: "clip", file, time: 20 });

		expect(seekCount).toBe(2);
	});
});
