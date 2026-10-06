export type Rgb = [number, number, number];

export interface LutData {
	size: number;
	domainMin: Rgb;
	domainMax: Rgb;
	/** RGB triples in .cube order: red changes fastest, then green, then blue. */
	data: Float32Array;
}

export interface CubeLut extends LutData {
	title: string | null;
}

export class CubeParseError extends Error {}

const MIN_SIZE = 2;
const MAX_SIZE = 65;

function parseTriple({ parts, line }: { parts: string[]; line: string }): Rgb {
	const values = parts.slice(0, 3).map(Number);
	if (values.length < 3 || values.some((value) => !Number.isFinite(value))) {
		throw new CubeParseError(`Invalid numbers in line: "${line}"`);
	}
	return [values[0], values[1], values[2]];
}

/** Parses an Adobe/Resolve .cube 3D LUT. */
export function parseCubeLut({ text }: { text: string }): CubeLut {
	let title: string | null = null;
	let size: number | null = null;
	let domainMin: Rgb = [0, 0, 0];
	let domainMax: Rgb = [1, 1, 1];
	const values: number[] = [];

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		const keyword = parts[0];

		if (keyword === "TITLE") {
			title = line.slice("TITLE".length).trim().replace(/^"|"$/g, "") || null;
			continue;
		}
		if (keyword === "LUT_1D_SIZE") {
			throw new CubeParseError("1D LUTs aren't supported. Use a 3D .cube LUT.");
		}
		if (keyword === "LUT_3D_SIZE") {
			const parsed = Number(parts[1]);
			if (!Number.isInteger(parsed) || parsed < MIN_SIZE || parsed > MAX_SIZE) {
				throw new CubeParseError(`LUT size must be between ${MIN_SIZE} and ${MAX_SIZE} (got ${parts[1]}).`);
			}
			size = parsed;
			continue;
		}
		if (keyword === "DOMAIN_MIN") {
			domainMin = parseTriple({ parts: parts.slice(1), line });
			continue;
		}
		if (keyword === "DOMAIN_MAX") {
			domainMax = parseTriple({ parts: parts.slice(1), line });
			continue;
		}
		// Other keywords (e.g. LUT_3D_INPUT_RANGE) are ignored.
		if (/^[A-Za-z_]/.test(keyword)) continue;

		values.push(...parseTriple({ parts, line }));
	}

	if (size === null) throw new CubeParseError("Missing LUT_3D_SIZE.");
	if (domainMax.some((max, channel) => max <= domainMin[channel])) {
		throw new CubeParseError("DOMAIN_MAX must be greater than DOMAIN_MIN on every channel.");
	}
	const expectedRows = size ** 3;
	if (values.length !== expectedRows * 3) {
		throw new CubeParseError(
			`Expected ${expectedRows} color rows for a ${size}³ LUT, found ${values.length / 3}.`,
		);
	}
	return { title, size, domainMin, domainMax, data: Float32Array.from(values) };
}
