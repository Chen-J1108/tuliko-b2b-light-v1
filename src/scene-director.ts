export type ChapterId = "hero" | "structure" | "acoustic" | "modular" | "interaction";

export const CHAPTER_IDS: ChapterId[] = [
  "hero",
  "structure",
  "acoustic",
  "modular",
  "interaction",
];

export interface SceneSnapshot {
  activeIndex: number;
  chapter: ChapterId;
  localProgress: number;
  narrative: number;
  pageProgress: number;
  reducedMotion: boolean;
  mobile: boolean;
  compact: boolean;
  visible: boolean;
  illumination: number;
}

export class SceneDirector {
  snapshot: SceneSnapshot = {
    activeIndex: 0,
    chapter: "hero",
    localProgress: 0,
    narrative: 0,
    pageProgress: 0,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    mobile: window.matchMedia?.("(max-width: 900px)").matches ?? false,
    compact: window.matchMedia?.("(max-width: 699px)").matches ?? false,
    visible: !document.hidden,
    illumination: 0,
  };

  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  invalidate() {
    this.notify();
  }

  setChapter(
    activeIndex: number,
    localProgress: number,
    pageProgress: number,
    narrativeOverride?: number,
  ) {
    const safeIndex = Math.min(CHAPTER_IDS.length - 1, Math.max(0, activeIndex));
    const nextLocalProgress = Math.min(1, Math.max(0, localProgress));
    const nextNarrative = narrativeOverride === undefined
      ? safeIndex + nextLocalProgress
      : Math.min(CHAPTER_IDS.length, Math.max(0, narrativeOverride));
    const nextPageProgress = Math.min(1, Math.max(0, pageProgress));
    const changed = this.snapshot.activeIndex !== safeIndex
      || Math.abs(this.snapshot.localProgress - nextLocalProgress) > 0.00001
      || Math.abs(this.snapshot.narrative - nextNarrative) > 0.00001
      || Math.abs(this.snapshot.pageProgress - nextPageProgress) > 0.00001;

    this.snapshot.activeIndex = safeIndex;
    this.snapshot.chapter = CHAPTER_IDS[safeIndex];
    this.snapshot.localProgress = nextLocalProgress;
    this.snapshot.narrative = nextNarrative;
    this.snapshot.pageProgress = nextPageProgress;
    if (changed) this.notify();
  }

  setEnvironment(values: Partial<Pick<SceneSnapshot, "reducedMotion" | "mobile" | "compact" | "visible">>) {
    const changed = Object.entries(values).some(([key, value]) => (
      this.snapshot[key as keyof SceneSnapshot] !== value
    ));
    if (!changed) return;
    Object.assign(this.snapshot, values);
    this.notify();
  }
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export const rangeProgress = (value: number, start: number, end: number) =>
  clamp01((value - start) / Math.max(0.0001, end - start));
