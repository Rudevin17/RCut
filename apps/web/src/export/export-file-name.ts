// Characters Windows forbids in file names, plus ASCII control characters.
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\x00-\x1f]/g;

export function getExportFileName({
	projectName,
	extension,
}: {
	projectName: string;
	extension: string;
}): string {
	const baseName = projectName
		.replace(INVALID_FILE_NAME_CHARACTERS, "_")
		.replace(/[. ]+$/, "")
		.trim();

	return `${baseName || "Untitled"}${extension}`;
}

export function joinExportPath({
	folder,
	fileName,
}: {
	folder: string;
	fileName: string;
}): string {
	return /[\\/]$/.test(folder)
		? `${folder}${fileName}`
		: `${folder}\\${fileName}`;
}
