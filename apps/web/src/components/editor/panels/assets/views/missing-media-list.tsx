"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import type { MissingMediaAsset } from "@/services/storage/types";

export function MissingMediaList({ projectId }: { projectId: string }) {
	const missingAssets = useEditor((e) => e.media.getMissingAssets());

	if (missingAssets.length === 0) return null;

	return (
		<div className="flex flex-col gap-1.5 border-b px-3 py-2">
			<p className="text-destructive text-xs font-medium">
				{missingAssets.length} missing{" "}
				{missingAssets.length === 1 ? "file" : "files"}
			</p>
			{missingAssets.map((asset) => (
				<MissingMediaRow key={asset.id} asset={asset} projectId={projectId} />
			))}
		</div>
	);
}

function MissingMediaRow({
	asset,
	projectId,
}: {
	asset: MissingMediaAsset;
	projectId: string;
}) {
	const editor = useEditor();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isRelinking, setIsRelinking] = useState(false);

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;

		setIsRelinking(true);
		try {
			await editor.media.relinkMediaAsset({ projectId, id: asset.id, file });
		} finally {
			setIsRelinking(false);
		}
	};

	return (
		<div className="flex items-center gap-2 text-xs" title={asset.sourcePath}>
			<span className="bg-destructive/15 text-destructive rounded-sm px-1.5 py-0.5">
				Missing
			</span>
			<span className="min-w-0 flex-1 truncate">{asset.name}</span>
			<input
				ref={inputRef}
				type="file"
				accept={`${asset.type}/*`}
				className="hidden"
				onChange={handleFileChange}
			/>
			<Button
				size="sm"
				variant="outline"
				disabled={isRelinking}
				onClick={() => inputRef.current?.click()}
			>
				Locate file
			</Button>
		</div>
	);
}
