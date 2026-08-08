const MAX_MODEL_CHOICES = 50;

export function filterModelIds(
	modelIds: readonly string[],
	query: string,
	limit = MAX_MODEL_CHOICES,
): string[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [];

	return modelIds
		.filter((modelId) => modelId.toLowerCase().includes(normalizedQuery))
		.slice(0, limit);
}
