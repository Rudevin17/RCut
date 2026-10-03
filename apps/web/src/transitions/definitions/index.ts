import { blockDissolveTransition } from "./block-dissolve";
import { crossfadeTransition } from "./crossfade";
import { datamoshStripTransition } from "./datamosh-strip";
import { doomMeltTransition } from "./doom-melt";
import { glitchDisplaceTransition } from "./glitch-displace";
import { glitchMemoriesTransition } from "./glitch-memories";
import { lostSignalTransition } from "./lost-signal";
import { parametricGlitchTransition } from "./parametric-glitch";
import { pixelizeTransition } from "./pixelize";
import { rgbSplitSlamTransition } from "./rgb-split-slam";
import { shakeHitTransition } from "./shake-hit";
import { spinBlurTransition } from "./spin-blur";
import { tvStaticTransition } from "./tv-static";
import { whipPanTransition } from "./whip-pan";
import { zoomPunchTransition } from "./zoom-punch";

export const TRANSITION_DEFINITIONS = [
	crossfadeTransition,
	whipPanTransition,
	glitchDisplaceTransition,
	glitchMemoriesTransition,
	datamoshStripTransition,
	parametricGlitchTransition,
	doomMeltTransition,
	lostSignalTransition,
	tvStaticTransition,
	pixelizeTransition,
	blockDissolveTransition,
	rgbSplitSlamTransition,
	zoomPunchTransition,
	spinBlurTransition,
	shakeHitTransition,
];
