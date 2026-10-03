import type { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import type {
	MediaAssetData,
	MissingMediaAsset,
} from "@/services/storage/types";
import { getMediaTypeFromFile } from "@/media/media-utils";
import {
	applyRelinkedAsset,
	isRelinkCompatible,
	toMediaAssetData,
} from "@/media/linked-media";
import { openLinkedFile, resolveFilePaths } from "@/services/linked-files";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private missingAssets: MissingMediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("Not enough browser storage", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand({
						projectId,
						assetId: uniqueIds[0],
					})
				: new BatchCommand(
						uniqueIds.map((id) =>
							new RemoveMediaAssetCommand({
								projectId,
								assetId: id,
							}),
						),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const { assets, missing } = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = assets;
			this.missingAssets = missing;
			this.notify();

			if (missing.length > 0) {
				toast.warning(
					`${missing.length} media ${missing.length === 1 ? "file is" : "files are"} missing`,
					{
						description:
							'Use "Locate file" in the Assets panel to find them.',
					},
				);
			}
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = [...this.assets, ...this.missingAssets].map(
			(asset) => asset.id,
		);
		this.assets = [];
		this.missingAssets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.missingAssets = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	getMissingAssets(): MissingMediaAsset[] {
		return this.missingAssets;
	}

	async relinkMediaAsset({
		projectId,
		id,
		file,
	}: {
		projectId: string;
		id: string;
		file: File;
	}): Promise<boolean> {
		const missingAsset = this.missingAssets.find((asset) => asset.id === id);
		if (!missingAsset) return false;

		if (
			!isRelinkCompatible({
				missingAsset,
				fileType: getMediaTypeFromFile({ file }),
			})
		) {
			toast.error(`${file.name} is not a ${missingAsset.type} file`);
			return false;
		}

		const [path] = await resolveFilePaths({ files: [file] });
		if (!path) {
			toast.error(`Couldn't read the location of ${file.name}`);
			return false;
		}

		const result = await openLinkedFile({ path });
		if (result.status !== "ok") {
			toast.error(`Couldn't open ${file.name}`, {
				description:
					result.status === "error" ? result.message : "File not found",
			});
			return false;
		}

		const metadata: MediaAssetData = {
			...toMediaAssetData({ missingAsset }),
			sourcePath: path,
			size: result.file.size,
			lastModified: result.file.lastModified,
		};

		try {
			await storageService.saveMediaAssetMetadata({ projectId, metadata });
		} catch (error) {
			console.error("Failed to save relinked media:", error);
			toast.error(`Couldn't relink ${missingAsset.name}`);
			return false;
		}

		const next = applyRelinkedAsset({
			assets: this.assets,
			missingAssets: this.missingAssets,
			relinked: {
				...metadata,
				file: result.file,
				url: URL.createObjectURL(result.file),
			},
		});
		this.assets = next.assets;
		this.missingAssets = next.missingAssets;
		this.notify();

		toast.success(`Relinked ${missingAsset.name}`);
		return true;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
