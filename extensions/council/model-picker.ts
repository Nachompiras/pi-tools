const MAX_MODEL_CHOICES = 50;
const REMOVE_MODEL_PREFIX = "❌ Remove: ";

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

export function findModelRemovalIndex(models: readonly string[], action: string): number {
	if (!action.startsWith(REMOVE_MODEL_PREFIX)) return -1;
	return models.indexOf(action.slice(REMOVE_MODEL_PREFIX.length));
}
