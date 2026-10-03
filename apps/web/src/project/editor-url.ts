export function getEditorUrl({ projectId }: { projectId: string }): string {
	return `/editor/?id=${encodeURIComponent(projectId)}`;
}
