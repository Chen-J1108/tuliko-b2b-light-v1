import {
  animate,
  createTimeline,
  stagger,
  random,
  onScroll,
  createScope,
  createDrawable,
  createMotionPath,
} from "animejs";
import type { SceneDirector } from "../scene-director";
import { CHAPTER_IDS, clamp01, rangeProgress, smoothstep } from "../scene-director";
import { LOADING_COMPLETE_EVENT } from "../loading-events";

type Pausable = {
  pause?: () => unknown;
  resume?: () => unknown;
  revert?: () => unknown;
  completed?: boolean;
};

const query = <T extends Element>(root: Element, selector: string) => root.querySelector<T>(selector);
const queryAll = <T extends Element>(root: Element, selector: string) => [...root.querySelectorAll<T>(selector)];

export function initMotionSystem(root: HTMLElement, director: SceneDirector) {
  const sections = CHAPTER_IDS
    .map((id) => query<HTMLElement>(root, `#${id}`))
    .filter((section): section is HTMLElement => Boolean(section));
  const progressRail = query<HTMLElement>(root, "[data-progress-rail]");
  const progressTrack = query<HTMLElement>(root, ".progress-track");
  const progressCursor = query<HTMLElement>(root, "[data-progress-cursor]");
  const progressAnchors = queryAll<HTMLAnchorElement>(root, "[data-progress-anchor]");
  const teaserSections = queryAll<HTMLElement>(root, "[data-next-target]");
  const announcer = query<HTMLElement>(root, "[data-chapter-announcer]");
  const productReference = query<HTMLImageElement>(root, ".webgl-reference");
  const spatialScenes = queryAll<HTMLElement>(root, "[data-spatial-scene]");
  const copyCharacterGroups = sections.map((section) => queryAll<HTMLElement>(section, "[data-copy-char]"));
  const activeTimers = new Set<Pausable>();
  let activeIndex = -1;
  let initialFrame = 0;
  let settleFrame = 0;
  let hasPlayedIllumination = false;
  let hasPlayedProductIntro = false;
  let hasPlayedWaveReveal = false;

  const track = <T extends Pausable>(item: T) => {
    activeTimers.add(item);
    return item;
  };

  const syncHeroProductBoundary = () => {
    if (!productReference) return;
    const rect = productReference.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    // Use layout coordinates rather than the client rectangle so the product
    // boundary stays stable while the one-time lighting reveal is running.
    const imageLeft = productReference.offsetLeft - rect.width * 0.5;
    const imageTop = productReference.offsetTop - rect.height * 0.5;

    // Ratios are measured from the authoritative transparent SPD01 WebP.
    // They deliberately describe the visible shell and front-glass opening,
    // not the image element's transparent padding.
    const shellLeft = imageLeft + rect.width * 0.22;
    const shellRight = imageLeft + rect.width * 0.78;
    const glassLeft = imageLeft + rect.width * 0.24;
    const glassRight = imageLeft + rect.width * 0.55;
    const glassTop = imageTop + rect.height * 0.13;
    const glassBottom = imageTop + rect.height * 0.87;

    root.style.setProperty("--hero-shell-left", `${shellLeft.toFixed(2)}px`);
    root.style.setProperty("--hero-shell-right", `${shellRight.toFixed(2)}px`);
    root.style.setProperty("--hero-glass-left", `${glassLeft.toFixed(2)}px`);
    root.style.setProperty("--hero-glass-top", `${glassTop.toFixed(2)}px`);
    root.style.setProperty("--hero-glass-width", `${Math.max(1, glassRight - glassLeft).toFixed(2)}px`);
    root.style.setProperty("--hero-glass-height", `${Math.max(1, glassBottom - glassTop).toFixed(2)}px`);
  };

  const applyScrollState = () => {
    const viewportHeight = Math.max(1, window.innerHeight);
    const desktopLayout = window.matchMedia("(min-width: 901px)").matches;
    const maximumScroll = Math.max(1, document.documentElement.scrollHeight - viewportHeight);
    const pageProgress = clamp01(window.scrollY / maximumScroll);
    const sectionRects = sections.map((section) => section.getBoundingClientRect());
    const sectionProgresses = sectionRects.map((rect, index) => {
      // Serve's editorial sequence advances by one viewport per message while
      // the product canvas stays pinned behind it. Use the section's own
      // viewport-height for those rows instead of a synthetic pinned distance.
      if (desktopLayout && index >= 2) {
        return clamp01(-rect.top / Math.max(1, rect.height));
      }
      const pinnedDistance = Math.max(1, rect.height - viewportHeight);
      return clamp01(-rect.top / pinnedDistance);
    });
    let baseIndex = 0;

    sections.forEach((section, index) => {
      const rect = sectionRects[index];
      const progress = sectionProgresses[index] ?? 0;
      const usesReferenceFlow = desktopLayout && index >= 2;
      section.style.setProperty("--section-progress", progress.toFixed(5));

      // The reference keeps the copy block fully opaque and lets it move at
      // the same speed as the page. Only the heading characters reveal in
      // sequence while the block rises through the lower three quarters of
      // the viewport; the block itself never fades on exit.
      const usesFullCopyTrack = index >= 2;
      const isStructureOverview = index === 1;
      const copyEntry = index === 0
        ? 1
        : smoothstep(rangeProgress(progress, 0.035, 0.19));
      const copyExit = 1 - smoothstep(rangeProgress(
        progress,
        index === 0 ? 0.56 : 0.7,
        index === 0 ? 0.92 : 0.94,
      ));
      const copyVisibility = usesFullCopyTrack || director.snapshot.reducedMotion
        ? 1
        : isStructureOverview
          ? 1
          : copyEntry * copyExit;
      const copyOffset = director.snapshot.reducedMotion
        ? 0
        : usesReferenceFlow
          ? 0
          : usesFullCopyTrack
          ? viewportHeight * 1.04 * (1 - progress * 2)
          : isStructureOverview
            ? 0
            : (1 - copyEntry) * 36 - smoothstep(rangeProgress(progress, 0.52, 0.96)) * 48;
      section.style.setProperty("--copy-visibility", copyVisibility.toFixed(4));
      section.style.setProperty("--copy-scroll-y", `${copyOffset.toFixed(2)}px`);

      const copyCharacters = copyCharacterGroups[index] ?? [];
      if (copyCharacters.length) {
        const reveal = director.snapshot.reducedMotion
          ? 1
          : usesReferenceFlow
            // Begin the ordered reveal as the copy enters from below and
            // finish shortly before it reaches the editorial reading line.
            ? clamp01((viewportHeight * 0.5 - rect.top) / (viewportHeight * 0.4))
            : rangeProgress(progress, 0, 0.36);
        const revealCursor = reveal * (copyCharacters.length + 8);
        copyCharacters.forEach((character, characterIndex) => {
          const opacity = smoothstep(clamp01((revealCursor - characterIndex) / 8));
          character.style.setProperty("--copy-char-opacity", opacity.toFixed(4));
        });
      }
      if (rect.top <= 1) baseIndex = index;
    });
    const acousticSection = sections[2];
    // The common copy track now owns the entire bottom-to-top journey. Keep
    // the acoustic-specific values neutral so they cannot shorten or double
    // the travel distance.
    acousticSection?.style.setProperty("--acoustic-copy-offset", "0px");
    acousticSection?.style.setProperty("--acoustic-copy-opacity", "1");
    const modularSection = sections[3];
    modularSection?.style.setProperty("--modular-entry", "1");
    const interactionSection = sections[4];
    interactionSection?.style.setProperty("--interaction-entry", "1");

    let activeTease = 0;
    const compactLayout = window.matchMedia("(max-width: 699px)").matches;
    teaserSections.forEach((section) => {
      const storyIndex = sections.indexOf(section);
      let rawTease = 0;

      if (storyIndex >= 0) {
        const sectionProgress = sectionProgresses[storyIndex] ?? 0;
        rawTease = rangeProgress(sectionProgress, compactLayout ? 0.76 : 0.8, 1);
      } else {
        const nextId = section.dataset.nextTarget;
        const nextSection = nextId ? document.getElementById(nextId) : null;
        if (nextSection) {
          const nextTop = nextSection.getBoundingClientRect().top;
          const triggerLine = viewportHeight * (compactLayout ? 0.9 : 0.86);
          const revealDistance = viewportHeight * (compactLayout ? 0.14 : 0.18);
          rawTease = clamp01((triggerLine - nextTop) / Math.max(1, revealDistance));
        }
      }

      const tease = director.snapshot.reducedMotion
        ? (rawTease > 0 ? 1 : 0)
        : smoothstep(rawTease);
      section.style.setProperty("--section-tease", tease.toFixed(5));
      section.toggleAttribute("data-teaser-visible", tease > 0.015);
      if (storyIndex === baseIndex) activeTease = tease;
    });

    const followingIndex = Math.min(sections.length - 1, baseIndex + 1);
    const followingRect = sectionRects[followingIndex];
    const transitionDistance = viewportHeight * 0.68;
    const transitionProgress = followingIndex === baseIndex
      ? 0
      : smoothstep(clamp01((transitionDistance - followingRect.top) / transitionDistance));
    const nextIndex = transitionProgress >= 0.5 ? followingIndex : baseIndex;
    const activeSection = sections[nextIndex];
    const activeRect = sectionRects[nextIndex];
    const localProgress = sectionProgresses[nextIndex] ?? 0;
    const heroModelMix = baseIndex > 0
      ? 1
      : baseIndex === 0
        ? transitionProgress
        : 0;
    // Keep the photographic hero, 3D stage and technical drawing surface in
    // the same scroll-linked hand-off. The previous chapter switch changed
    // all three at once, making the structure scene feel like a cut.
    const structureHandoff = baseIndex === 0 && followingIndex === 1
      ? smoothstep(rangeProgress(heroModelMix, 0.08, 0.92))
      : baseIndex === 1
        ? 1 - smoothstep(transitionProgress)
        : 0;
    const rasterOpacity = director.snapshot.reducedMotion
      ? (heroModelMix < 0.5 ? 1 : 0)
      : 1 - smoothstep(clamp01((heroModelMix - 0.14) / 0.62));
    const glbOpacity = director.snapshot.reducedMotion
      ? (heroModelMix >= 0.5 ? 1 : 0)
      : smoothstep(clamp01((heroModelMix - 0.26) / 0.58));
    // Preserve the approved hero composition. Subsequent chapters retain the
    // lateral product hand-offs while the opening stays in its original lane.
    const stageCenters = [68, 52, 68, 32, 68];
    const stageCenter = desktopLayout
      ? stageCenters[baseIndex] + (stageCenters[followingIndex] - stageCenters[baseIndex]) * transitionProgress
      : 50;
    const scenePosition = baseIndex + transitionProgress;
    spatialScenes.forEach((scene) => {
      const sceneIndex = Number(scene.dataset.spatialScene || 0);
      const distance = sceneIndex - scenePosition;
      const absoluteDistance = Math.abs(distance);
      const presence = director.snapshot.reducedMotion
        ? (sceneIndex === nextIndex ? 1 : 0)
        : 1 - smoothstep(clamp01(absoluteDistance));
      const signedFold = director.snapshot.reducedMotion
        ? 0
        : Math.max(-1, Math.min(1, distance));

      scene.style.setProperty("--scene-presence", presence.toFixed(5));
      scene.style.setProperty("--scene-shift-x", `${(signedFold * 5.5).toFixed(3)}vw`);
      scene.style.setProperty("--scene-rotate-y", `${(-signedFold * 7.5).toFixed(3)}deg`);
      scene.style.setProperty("--scene-depth", `${(director.snapshot.reducedMotion ? 0 : -absoluteDistance * 90).toFixed(2)}px`);
      scene.style.setProperty("--scene-fold", (director.snapshot.reducedMotion ? 0 : clamp01(absoluteDistance)).toFixed(5));
      scene.classList.toggle("is-current", presence > 0.56);
    });
    const heroMeterVisibility = 1 - smoothstep(rangeProgress(sectionProgresses[0] ?? 0, 0.42, 0.7));
    const acousticRect = sectionRects[2];
    const acousticEntry = acousticRect
      ? smoothstep(clamp01((viewportHeight * 0.84 - acousticRect.top) / (viewportHeight * 0.54)))
      : 0;
    const acousticExit = 1 - smoothstep(rangeProgress(sectionProgresses[2] ?? 0, 0.7, 0.92));
    const rawMeterVisibility = clamp01(Math.max(heroMeterVisibility, acousticEntry * acousticExit));
    const meterVisibility = director.snapshot.reducedMotion
      ? (rawMeterVisibility >= 0.5 ? 1 : 0)
      : rawMeterVisibility;

    // The desktop editorial rows use a continuous narrative clock. Product
    // motion starts as the incoming message enters the lower half of the
    // viewport and settles when that message reaches its reading position.
    // This mirrors Serve's fixed-product / natural-copy browsing rule and
    // avoids chapter-state snaps during a hand-off.
    const narrativeOverride = desktopLayout && acousticRect && acousticRect.top <= viewportHeight * 0.5
      ? Math.min(CHAPTER_IDS.length, Math.max(2, 2.5 - acousticRect.top / viewportHeight))
      : undefined;
    director.setChapter(nextIndex, localProgress, pageProgress, narrativeOverride);
    root.dataset.chapter = CHAPTER_IDS[nextIndex];
    root.style.setProperty("--page-progress", pageProgress.toFixed(6));
    root.style.setProperty("--chapter-progress", localProgress.toFixed(6));
    root.style.setProperty("--active-tease", activeTease.toFixed(6));
    root.style.setProperty("--meter-visibility", meterVisibility.toFixed(6));
    root.style.setProperty("--hero-model-mix", heroModelMix.toFixed(6));
    root.style.setProperty("--hero-raster-opacity", rasterOpacity.toFixed(6));
    root.style.setProperty("--hero-glb-opacity", glbOpacity.toFixed(6));
    root.style.setProperty("--structure-bg-mix", `${(structureHandoff * 100).toFixed(3)}%`);
    root.style.setProperty("--stage-center-x", `${stageCenter.toFixed(3)}%`);
    syncHeroProductBoundary();

    sections.forEach((section, index) => section.classList.toggle("is-active", index === nextIndex));
    progressAnchors.forEach((anchor, index) => {
      const weight = index === baseIndex
        ? 1 - transitionProgress
        : index === followingIndex
          ? transitionProgress
          : 0;
      const current = index === nextIndex;
      anchor.style.setProperty("--anchor-opacity", (0.66 + weight * 0.34).toFixed(4));
      anchor.style.setProperty("--anchor-scale", (0.64 + weight * 0.36).toFixed(4));
      anchor.classList.toggle("is-active", current);
      if (current) anchor.setAttribute("aria-current", "location");
      else anchor.removeAttribute("aria-current");
    });

    if (progressCursor && progressTrack) {
      const travel = desktopLayout
        ? Math.max(0, progressTrack.clientHeight - progressCursor.offsetHeight)
        : Math.max(0, progressTrack.clientWidth - progressCursor.offsetWidth);
      const distance = (travel * pageProgress).toFixed(2);
      progressCursor.style.transform = desktopLayout
        ? `translate3d(0, ${distance}px, 0)`
        : `translate3d(${distance}px, 0, 0)`;
    }
    progressRail?.setAttribute("aria-label", `ページ進捗 ${Math.round(pageProgress * 100)}%`);

    if (activeIndex !== nextIndex) {
      activeIndex = nextIndex;
      if (announcer) announcer.textContent = sections[nextIndex]?.getAttribute("aria-label") || CHAPTER_IDS[nextIndex];
    }
  };

  const pageObserver = onScroll({
    target: root,
    enter: "top top",
    leave: "bottom bottom",
    repeat: true,
    onEnter: applyScrollState,
    onUpdate: applyScrollState,
    onResize: applyScrollState,
  });

  const pageResizeObserver = new ResizeObserver(() => {
    pageObserver.refresh();
    applyScrollState();
  });
  pageResizeObserver.observe(root);
  productReference?.addEventListener("load", applyScrollState);

  const scope = createScope({
    root,
    mediaQueries: {
      desktop: "(min-width: 901px)",
      mobile: "(max-width: 900px)",
      compact: "(max-width: 699px)",
      reduced: "(prefers-reduced-motion: reduce)",
    },
  });

  scope.add((self) => {
    if (!self) return undefined;
    const reduced = self.matches.reduced;
    const mobile = self.matches.mobile;
    const compact = self.matches.compact;
    const localTimers: Pausable[] = [];
    let waitingForLoading = false;
    const keep = <T extends Pausable>(timer: T) => {
      localTimers.push(timer);
      return track(timer);
    };

    director.setEnvironment({ reducedMotion: reduced, mobile, compact });
    root.classList.toggle("is-reduced-motion", reduced);
    root.classList.toggle("is-compact-render", compact);

    const playHeroEntrance = () => {
      waitingForLoading = false;
      const startsAtHero = (!window.location.hash || window.location.hash === "#hero")
        && window.scrollY < window.innerHeight * 0.45;

      if (!startsAtHero) {
        // A direct anchor refresh must expose the requested chapter immediately.
        director.snapshot.illumination = 1;
        hasPlayedIllumination = true;
        hasPlayedProductIntro = true;
        hasPlayedWaveReveal = true;
        return;
      }

      if (!hasPlayedIllumination) {
        hasPlayedIllumination = true;
        director.snapshot.illumination = 0;
        const intro = keep(createTimeline({ defaults: { ease: "outExpo" } }));
        intro
          .add(director.snapshot, {
            illumination: 0.34,
            duration: 520,
            ease: "outQuad",
          }, 80)
          .add(director.snapshot, {
            illumination: 1,
            duration: 1120,
            ease: "inOutQuad",
          }, 420);
      } else {
        director.snapshot.illumination = 1;
      }

      if (!hasPlayedProductIntro) {
        hasPlayedProductIntro = true;
        const productIntro = keep(createTimeline({ defaults: { ease: "outExpo" } }));
        productIntro
          .add("[data-product-reveal]", {
            opacity: [0.04, 1],
            filter: [
              "brightness(0.22) saturate(0.62) contrast(1.1)",
              "brightness(1) saturate(1) contrast(1)",
            ],
            duration: compact ? 1180 : 1520,
          }, 40)
          .add(".product-intro-scan", {
            translateY: compact ? ["18lvh", "76lvh"] : ["10lvh", "88lvh"],
            scaleX: [0.28, 1, 0.46],
            opacity: [0, 0.74, 0],
            duration: compact ? 980 : 1320,
            ease: "inOutQuad",
          }, 120);
      }

      if (!hasPlayedWaveReveal) {
        hasPlayedWaveReveal = true;
        const waveReveal = keep(createTimeline({ defaults: { ease: "outQuad" } }));
        waveReveal
          .add(".incoming-wave-boundary", {
            opacity: [0, 1],
            scaleY: [0.12, 1],
            duration: 360,
          }, 560)
          .add(".outgoing-wave-line", {
            scaleX: [0, 1],
            duration: () => random(compact ? 680 : 840, compact ? 820 : 1040),
            delay: stagger(compact ? 30 : 38, { from: "first" }),
          }, 760);
      }

    };

    const handleLoadingComplete = () => playHeroEntrance();

    if (reduced) {
      director.snapshot.illumination = 1;
      hasPlayedIllumination = true;
      hasPlayedProductIntro = true;
      hasPlayedWaveReveal = true;
    } else {
      if (root.dataset.loadingComplete === "true") playHeroEntrance();
      else {
        waitingForLoading = true;
        root.addEventListener(LOADING_COMPLETE_EVENT, handleLoadingComplete, { once: true });
      }

      // The waves play automatically, while the fixed stage's chapter state
      // controls their placement, opacity and hand-off into the acoustic
      // scene. This keeps a living signal without making it a detached effect.
      // Animate each complete red waveform as a musical phrase. Different
      // phases make the field feel like a living sound wave, while keeping
      // every path endpoint locked to the product boundary.
      keep(animate(".incoming-wave-lane", {
        scaleY: [0.68, 1.28, 0.84, 1.12, 0.68],
        opacity: [0.54, 1, 0.72, 0.94, 0.54],
        duration: compact ? 2600 : 3460,
        delay: stagger(compact ? 260 : 360, { from: "first" }),
        ease: "inOutSine",
        loop: Infinity,
        loopDelay: 0,
      }));

      keep(animate(".outgoing-wave-flow", {
        // Travel exactly one 100-unit dash pattern per cycle so the loop seam
        // is mathematically identical and never flashes backward.
        strokeDashoffset: [12, -88],
        duration: compact ? 3200 : 3800,
        delay: stagger(compact ? 140 : 210, { from: "first" }),
        ease: "linear",
        loop: true,
      }));

      keep(animate(".outgoing-wave-lane", {
        // Let the transmitted field breathe as a complete waveform. The
        // endpoints stay locked and the phase remains deliberately slower and
        // quieter than the incident red field.
        scaleY: [0.58, 1.48, 0.76, 1.24, 0.58],
        opacity: [0.48, 0.92, 0.62, 0.82, 0.48],
        duration: compact ? 3500 : 4300,
        delay: stagger(compact ? 190 : 260, { from: "first" }),
        ease: "inOutSine",
        loop: Infinity,
        loopDelay: 0,
      }));

      const guideRings = queryAll<SVGCircleElement>(root, ".guide-target-ring");
      if (guideRings.length) {
        const guideScroll = onScroll({
          target: query<HTMLElement>(root, "#structure") || undefined,
          enter: "top top",
          leave: "bottom bottom",
          sync: true,
        });
        keep(animate(createDrawable(guideRings), {
          draw: ["0 0", "0 1"],
          duration: 1000,
          ease: "linear",
          autoplay: guideScroll,
        }));
      }

      const acousticSection = query<HTMLElement>(root, "#acoustic");
      const boundaryGates = queryAll<HTMLElement>(root, ".acoustic-boundary-gate");
      if (boundaryGates.length && acousticSection) {
        const boundaryScroll = onScroll({
          target: acousticSection,
          enter: "bottom top",
          leave: "top bottom",
          sync: true,
        });
        keep(animate(boundaryGates, {
          // Resolve the boundary early, then hold it while the acoustic stage is
          // centred. Extra keyframes create the hold without a looping effect.
          scaleY: [0.12, 1, 1, 1],
          opacity: [0, 1, 1, 1],
          duration: 1000,
          delay: stagger(70, { from: "first" }),
          ease: "linear",
          autoplay: boundaryScroll,
        }));
      }

    }

    applyScrollState();
    return () => {
      if (waitingForLoading) root.removeEventListener(LOADING_COMPLETE_EVENT, handleLoadingComplete);
      localTimers.forEach((timer) => activeTimers.delete(timer));
    };
  });

  const handleVisibility = () => {
    const visible = !document.hidden;
    root.classList.toggle("is-page-hidden", !visible);
    director.setEnvironment({ visible });
    activeTimers.forEach((timer) => {
      if (!visible) timer.pause?.();
      else if (!timer.completed) timer.resume?.();
    });
  };

  document.addEventListener("visibilitychange", handleVisibility);
  handleVisibility();

  const syncHashState = (forcePosition = false) => {
    const hash = window.location.hash.slice(1);
    const target = hash ? document.getElementById(hash) : null;
    if (forcePosition && target) {
      target.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    }
    pageObserver.refresh();
    applyScrollState();
    settleFrame = requestAnimationFrame(applyScrollState);
  };

  const handleHashChange = () => {
    if (settleFrame) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => syncHashState(false));
  };

  window.addEventListener("hashchange", handleHashChange);
  initialFrame = requestAnimationFrame(() => {
    syncHashState(true);
  });

  return () => {
    if (initialFrame) cancelAnimationFrame(initialFrame);
    if (settleFrame) cancelAnimationFrame(settleFrame);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("hashchange", handleHashChange);
    productReference?.removeEventListener("load", applyScrollState);
    pageResizeObserver.disconnect();
    pageObserver.revert();
    scope.revert();
    activeTimers.clear();
  };
}
