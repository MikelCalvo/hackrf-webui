import { aisRuntime } from "@/server/ais-runtime";
import { isReplayModeEnabled, replayAisService } from "@/server/replay-feed";

export const aisService = isReplayModeEnabled() ? replayAisService : aisRuntime;
