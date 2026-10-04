"use client";

import { type ReactNode, useState } from "react";
import type { FrameRate } from "opencut-wasm";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { EXPORT_FORMAT_VALUES, EXPORT_QUALITY_VALUES } from "@/export";
import { useExportSettingsStore } from "@/export/export-settings-store";
import { BUILT_IN_EXPORT_PRESETS, type ExportPreset } from "@/export/presets";
import {
	EXPORT_QUALITY_LABELS,
	clampMbps,
	formatExportSummary,
	formatFrameRate,
	getPresetWarnings,
	resolveEncodeParams,
	resolveExportSize,
	type ExportSize,
} from "@/export/resolve";
import {
	AUDIO_BITRATE_KBPS_VALUES,
	BITRATE_MODE_VALUES,
	CUSTOM_MBPS_MAX,
	CUSTOM_MBPS_MIN,
	EXPORT_FRAME_RATE_VALUES,
	EXPORT_RESOLUTION_VALUES,
	type ExportSettings,
} from "@/export/settings";

const QUALITY_PREFIX = "quality:";
const DEFAULT_CUSTOM_MBPS = 12;

function isOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
	return values.some((candidate) => candidate === value);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<Label htmlFor={htmlFor} className="text-muted-foreground shrink-0 text-xs">
				{label}
			</Label>
			<div className="w-48">{children}</div>
		</div>
	);
}

function bitrateSelectValue({ settings }: { settings: ExportSettings }): string {
	const { videoBitrate } = settings;
	return videoBitrate.kind === "quality"
		? `${QUALITY_PREFIX}${videoBitrate.quality}`
		: videoBitrate.kind;
}

export function ExportSettingsForm({
	settings,
	onChange,
	projectSize,
	projectFps,
}: {
	settings: ExportSettings;
	onChange: (settings: ExportSettings) => void;
	projectSize: ExportSize;
	projectFps: FrameRate;
}) {
	const { customPresets, addCustomPreset, removeCustomPreset } =
		useExportSettingsStore();
	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [isModified, setIsModified] = useState(false);
	const [isNaming, setIsNaming] = useState(false);
	const [presetName, setPresetName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);

	const allPresets: ExportPreset[] = [...BUILT_IN_EXPORT_PRESETS, ...customPresets];
	const selectedPreset =
		allPresets.find((preset) => preset.id === selectedPresetId) ?? null;
	const isCustomPresetSelected = customPresets.some(
		(preset) => preset.id === selectedPresetId,
	);
	const presetLabel = !selectedPreset
		? "Custom"
		: isModified
			? `Custom (from ${selectedPreset.name})`
			: selectedPreset.name;

	const params = resolveEncodeParams({ settings, projectSize, projectFps });
	const warnings = selectedPreset
		? getPresetWarnings({ preset: selectedPreset, projectSize })
		: [];

	const update = (patch: Partial<ExportSettings>) => {
		onChange({ ...settings, ...patch });
		setIsModified(true);
	};

	const selectPreset = (id: string) => {
		const preset = allPresets.find((candidate) => candidate.id === id);
		if (!preset) return;
		onChange(preset.settings);
		setSelectedPresetId(preset.id);
		setIsModified(false);
	};

	const deleteSelectedPreset = () => {
		if (!selectedPresetId) return;
		removeCustomPreset({ id: selectedPresetId });
		setSelectedPresetId(null);
	};

	const savePreset = () => {
		const result = addCustomPreset({ name: presetName, settings });
		if (!result.ok) {
			setNameError(result.error);
			return;
		}
		setSelectedPresetId(result.id);
		setIsModified(false);
		setIsNaming(false);
		setPresetName("");
		setNameError(null);
	};

	const changeBitrate = (value: string) => {
		if (value === "custom") {
			update({
				videoBitrate: {
					kind: "custom",
					mbps:
						typeof params.videoBitrate === "number"
							? params.videoBitrate / 1_000_000
							: DEFAULT_CUSTOM_MBPS,
				},
			});
			return;
		}
		const quality = value.slice(QUALITY_PREFIX.length);
		if (value.startsWith(QUALITY_PREFIX) && isOneOf(EXPORT_QUALITY_VALUES, quality)) {
			update({ videoBitrate: { kind: "quality", quality } });
		}
	};

	return (
		<div className="flex flex-col">
			<div className="flex flex-col gap-2 p-3">
				<div className="flex items-center gap-2">
					{/* An empty value after edits lets the same preset be re-applied. */}
					<Select
						value={isModified ? "" : (selectedPresetId ?? "")}
						onValueChange={selectPreset}
					>
						<SelectTrigger className="h-8 flex-1" aria-label="Export preset">
							<span className="truncate">{presetLabel}</span>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>Built-in</SelectLabel>
								{BUILT_IN_EXPORT_PRESETS.map((preset) => (
									<SelectItem key={preset.id} value={preset.id}>
										{preset.name}
									</SelectItem>
								))}
							</SelectGroup>
							{customPresets.length > 0 && (
								<SelectGroup>
									<SelectLabel>My presets</SelectLabel>
									{customPresets.map((preset) => (
										<SelectItem key={preset.id} value={preset.id}>
											{preset.name}
										</SelectItem>
									))}
								</SelectGroup>
							)}
						</SelectContent>
					</Select>
					{isCustomPresetSelected && selectedPreset && (
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Delete preset ${selectedPreset.name}`}
							onClick={deleteSelectedPreset}
						>
							<Trash2 className="size-4" />
						</Button>
					)}
				</div>

				<Field label="Format">
					<Select
						value={settings.format}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_FORMAT_VALUES, value)) update({ format: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="mp4">MP4 (H.264)</SelectItem>
							<SelectItem value="webm">WebM (VP9)</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				<Field label="Resolution">
					<Select
						value={settings.resolution}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_RESOLUTION_VALUES, value)) update({ resolution: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_RESOLUTION_VALUES.map((resolution) => {
								const size = resolveExportSize({ projectSize, resolution });
								const name =
									resolution === "project"
										? "Project"
										: resolution === "2160"
											? "4K"
											: `${resolution}p`;
								return (
									<SelectItem key={resolution} value={resolution}>
										{`${name} (${size.width}×${size.height})`}
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</Field>

				<Field label="Frame rate">
					<Select
						value={settings.frameRate}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_FRAME_RATE_VALUES, value)) update({ frameRate: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_FRAME_RATE_VALUES.map((frameRate) => (
								<SelectItem key={frameRate} value={frameRate}>
									{frameRate === "project"
										? `Project (${formatFrameRate(projectFps)} fps)`
										: `${frameRate} fps`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>

				<Field label="Bitrate">
					<Select value={bitrateSelectValue({ settings })} onValueChange={changeBitrate}>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_QUALITY_VALUES.map((quality) => (
								<SelectItem key={quality} value={`${QUALITY_PREFIX}${quality}`}>
									{`${EXPORT_QUALITY_LABELS[quality]} quality`}
								</SelectItem>
							))}
							{settings.videoBitrate.kind === "by-fps" && (
								<SelectItem value="by-fps">
									{`${settings.videoBitrate.mbpsUpTo30} / ${settings.videoBitrate.mbpsAbove30} Mbps (by fps)`}
								</SelectItem>
							)}
							<SelectItem value="custom">Custom (Mbps)</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				{settings.videoBitrate.kind === "custom" && (
					<Field label="Mbps" htmlFor="export-mbps">
						<Input
							id="export-mbps"
							type="number"
							min={CUSTOM_MBPS_MIN}
							max={CUSTOM_MBPS_MAX}
							step={0.5}
							value={settings.videoBitrate.mbps}
							onChange={(event) => {
								const mbps = Number(event.target.value);
								if (Number.isFinite(mbps)) update({ videoBitrate: { kind: "custom", mbps } });
							}}
							onBlur={() => {
								if (settings.videoBitrate.kind !== "custom") return;
								const clamped = clampMbps(settings.videoBitrate.mbps);
								if (clamped !== settings.videoBitrate.mbps) {
									update({ videoBitrate: { kind: "custom", mbps: clamped } });
								}
							}}
						/>
					</Field>
				)}
			</div>

			<Section collapsible defaultOpen={false}>
				<SectionHeader>
					<SectionTitle>Advanced</SectionTitle>
				</SectionHeader>
				<SectionContent className="flex flex-col gap-2">
					<Field label="Bitrate mode">
						<Select
							value={settings.bitrateMode}
							onValueChange={(value) => {
								if (isOneOf(BITRATE_MODE_VALUES, value)) update({ bitrateMode: value });
							}}
						>
							<SelectTrigger className="h-8 w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="variable">Variable (VBR)</SelectItem>
								<SelectItem value="constant">Constant (CBR)</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<div className="flex items-center space-x-2">
						<Checkbox
							id="include-audio"
							checked={settings.includeAudio}
							onCheckedChange={(checked) => update({ includeAudio: !!checked })}
						/>
						<Label htmlFor="include-audio">Include audio</Label>
					</div>
					<Field label="Audio bitrate">
						<Select
							disabled={!settings.includeAudio}
							value={String(settings.audioBitrateKbps)}
							onValueChange={(value) => {
								const kbps = Number(value);
								if (isOneOf(AUDIO_BITRATE_KBPS_VALUES, kbps)) update({ audioBitrateKbps: kbps });
							}}
						>
							<SelectTrigger className="h-8 w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AUDIO_BITRATE_KBPS_VALUES.map((kbps) => (
									<SelectItem key={kbps} value={String(kbps)}>
										{`${kbps} kbps`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				</SectionContent>
			</Section>

			<div className="flex flex-col gap-2 p-3">
				<p className="text-muted-foreground text-xs">{formatExportSummary({ params })}</p>
				{warnings.map((warning) => (
					<p key={warning} className="text-xs text-amber-500">
						{warning}
					</p>
				))}
				{isNaming ? (
					<div className="flex flex-col gap-1">
						<div className="flex gap-2">
							<Input
								autoFocus
								aria-label="Preset name"
								placeholder="Preset name"
								value={presetName}
								onChange={(event) => {
									setPresetName(event.target.value);
									setNameError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") savePreset();
								}}
							/>
							<Button size="sm" onClick={savePreset}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setIsNaming(false);
									setNameError(null);
								}}
							>
								Cancel
							</Button>
						</div>
						{nameError && <p className="text-destructive text-xs">{nameError}</p>}
					</div>
				) : (
					<Button
						size="sm"
						variant="ghost"
						className="self-start"
						onClick={() => setIsNaming(true)}
					>
						Save as preset…
					</Button>
				)}
			</div>
		</div>
	);
}
