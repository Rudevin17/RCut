import { invoke } from "@tauri-apps/api/core";
import { joinExportPath } from "@/export/export-file-name";

export function isNativeExportAvailable(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDefaultExportFolder(): Promise<string> {
	return invoke<string>("default_export_folder");
}

export async function pickExportFolder({
	currentFolder,
}: {
	currentFolder: string | null;
}): Promise<string | null> {
	const { open } = await import("@tauri-apps/plugin-dialog");
	const folder = await open({
		directory: true,
		defaultPath: currentFolder ?? undefined,
		title: "Choose export folder",
	});
	return typeof folder === "string" ? folder : null;
}

export async function pickExportFile({
	folder,
	fileName,
	extension,
}: {
	folder: string;
	fileName: string;
	extension: string;
}): Promise<string | null> {
	const { save } = await import("@tauri-apps/plugin-dialog");
	return save({
		defaultPath: joinExportPath({ folder, fileName }),
		filters: [{ name: `${extension.toUpperCase()} video`, extensions: [extension] }],
		title: "Export as",
	});
}

export async function saveExportToFolder({
	buffer,
	folder,
	fileName,
}: {
	buffer: ArrayBuffer;
	folder: string;
	fileName: string;
}): Promise<string> {
	return invoke<string>("save_export_to_folder", new Uint8Array(buffer), {
		headers: {
			"x-rcut-folder": encodeURIComponent(folder),
			"x-rcut-file-name": encodeURIComponent(fileName),
		},
	});
}

export async function saveExportAs({
	buffer,
	path,
}: {
	buffer: ArrayBuffer;
	path: string;
}): Promise<string> {
	return invoke<string>("save_export_as", new Uint8Array(buffer), {
		headers: { "x-rcut-path": encodeURIComponent(path) },
	});
}

export async function revealInFolder({ path }: { path: string }): Promise<void> {
	await invoke("reveal_in_folder", { path });
}
