"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { BUILTIN_LOOKS, isBuiltinLutId } from "@/luts/builtin-looks";
import { useLutLibrary } from "@/services/lut-library";

export function LutParamField({
	value,
	onPreview,
	onCommit,
}: {
	value: string;
	onPreview: (value: string) => void;
	onCommit: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const luts = useLutLibrary((state) => state.luts);
	const importFile = useLutLibrary((state) => state.importFile);
	const remove = useLutLibrary((state) => state.remove);

	const selected =
		BUILTIN_LOOKS.find((look) => look.id === value) ??
		luts.find((lut) => lut.id === value);
	const isLibraryLut = !isBuiltinLutId(value) && selected !== undefined;

	const select = (id: string) => {
		onPreview(id);
		onCommit();
	};

	const handleFile = async (file: File) => {
		try {
			select(await importFile({ file }));
		} catch (error) {
			toast.error("Couldn't import LUT", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1">
				<Select value={value} onValueChange={select}>
					<SelectTrigger className="w-full">
						{selected ? (
							<SelectValue>{selected.name}</SelectValue>
						) : (
							<span className="text-destructive">LUT missing</span>
						)}
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectLabel>Built-in</SelectLabel>
							{BUILTIN_LOOKS.map((look) => (
								<SelectItem key={look.id} value={look.id}>
									{look.name}
								</SelectItem>
							))}
						</SelectGroup>
						{luts.length > 0 && (
							<SelectGroup>
								<SelectLabel>My LUTs</SelectLabel>
								{luts.map((lut) => (
									<SelectItem key={lut.id} value={lut.id}>
										{lut.name}
									</SelectItem>
								))}
							</SelectGroup>
						)}
					</SelectContent>
				</Select>
				{isLibraryLut && (
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Remove ${selected.name} from library`}
						onClick={() =>
							remove({ id: value }).catch((error) =>
								toast.error("Couldn't remove LUT", {
									description: error instanceof Error ? error.message : String(error),
								}),
							)
						}
					>
						<HugeiconsIcon icon={Delete02Icon} />
					</Button>
				)}
			</div>
			<Button
				variant="outline"
				size="sm"
				onClick={() => inputRef.current?.click()}
			>
				Import .cube…
			</Button>
			<input
				ref={inputRef}
				type="file"
				accept=".cube"
				className="hidden"
				onChange={(event) => {
					const input = event.currentTarget;
					const file = input.files?.[0];
					input.value = "";
					if (file) void handleFile(file);
				}}
			/>
		</div>
	);
}
