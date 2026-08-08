import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { CouncilModelGateway } from "./openrouter.js";

export function createCouncilModelGateway(
	modelRegistry: Pick<ModelRegistry, "find" | "complete">,
): CouncilModelGateway {
	return {
		resolve(modelId) {
			const [provider, ...idParts] = modelId.split("/");
			return modelRegistry.find(provider, idParts.join("/"));
		},
		complete(model, context, signal) {
			const options = {
				signal,
				...(model.reasoning ? { reasoningEffort: "medium" as const } : {}),
			};
			return modelRegistry.complete(model, context, options);
		},
	};
}
