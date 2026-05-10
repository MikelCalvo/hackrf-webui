import { adsbRuntime } from "@/server/adsb-runtime";
import { isReplayModeEnabled, replayAdsbService } from "@/server/replay-feed";

export const adsbService = isReplayModeEnabled() ? replayAdsbService : adsbRuntime;
