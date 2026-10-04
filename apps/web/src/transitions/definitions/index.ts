import { blockDissolveTransition } from "./block-dissolve";
import { circleTransition } from "./circle";
import { crossZoomTransition } from "./cross-zoom";
import { crossfadeTransition } from "./crossfade";
import { crosswarpTransition } from "./crosswarp";
import { cubeTransition } from "./cube";
import { datamoshStripTransition } from "./datamosh-strip";
import { dipToBlackTransition } from "./dip-to-black";
import { dipToWhiteTransition } from "./dip-to-white";
import { doomMeltTransition } from "./doom-melt";
import { dreamyZoomTransition } from "./dreamy-zoom";
import { filmBurnTransition } from "./film-burn";
import { glitchDisplaceTransition } from "./glitch-displace";
import { glitchMemoriesTransition } from "./glitch-memories";
import { linearBlurTransition } from "./linear-blur";
import { lostSignalTransition } from "./lost-signal";
import { overexposureTransition } from "./overexposure";
import { pageCurlTransition } from "./page-curl";
import { parametricGlitchTransition } from "./parametric-glitch";
import { pixelizeTransition } from "./pixelize";
import { pushTransition } from "./push";
import { rgbSplitSlamTransition } from "./rgb-split-slam";
import { shakeHitTransition } from "./shake-hit";
import { slideTransition } from "./slide";
import { spinBlurTransition } from "./spin-blur";
import { swirlTransition } from "./swirl";
import { tvStaticTransition } from "./tv-static";
import { whipPanTransition } from "./whip-pan";
import { wipeTransition } from "./wipe";
import { zoomInOutTransition } from "./zoom-in-out";
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
	dipToBlackTransition,
	dipToWhiteTransition,
	slideTransition,
	pushTransition,
	zoomInOutTransition,
	wipeTransition,
	circleTransition,
	crossZoomTransition,
	dreamyZoomTransition,
	linearBlurTransition,
	filmBurnTransition,
	overexposureTransition,
	swirlTransition,
	cubeTransition,
	pageCurlTransition,
	crosswarpTransition,
];
