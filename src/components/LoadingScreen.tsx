import { useEffect, useRef, useState } from "react";
import {
  animate,
  createDrawable,
  createTimeline,
  stagger,
} from "animejs";
import { LOADING_COMPLETE_EVENT } from "../loading-events";

type Pausable = {
  pause?: () => unknown;
  resume?: () => unknown;
  revert?: () => unknown;
  completed?: boolean;
};

interface LoadingScreenProps {
  ready: boolean;
  onComplete: () => void;
}

const MINIMUM_DISPLAY_MS = 840;
const FALLBACK_TIMEOUT_MS = 7000;

export function LoadingScreen({ ready, onComplete }: LoadingScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<Pausable | null>(null);
  const animationsRef = useRef<Pausable[]>([]);
  const exitingRef = useRef(false);
  const finishedRef = useRef(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [fallbackElapsed, setFallbackElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.classList.add("is-loading");

    const minimumTimer = window.setTimeout(
      () => setMinimumElapsed(true),
      reduced ? 0 : MINIMUM_DISPLAY_MS,
    );
    const fallbackTimer = window.setTimeout(
      () => setFallbackElapsed(true),
      FALLBACK_TIMEOUT_MS,
    );

    if (reduced) {
      root.classList.add("is-reduced");
    } else {
      const paths = [...root.querySelectorAll<SVGPathElement>(".loading-wave-signal")];
      const intro = createTimeline({ defaults: { ease: "outExpo" } })
        .add(".loading-brand-part", {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: 560,
          delay: stagger(70, { from: "first" }),
        }, 40)
        .add(".loading-status-line", {
          opacity: [0, 1],
          translateY: [6, 0],
          duration: 480,
          delay: stagger(55, { from: "first" }),
        }, 160);

      animationsRef.current.push(intro);
      if (paths.length) {
        animationsRef.current.push(animate(createDrawable(paths), {
          draw: ["0 0", "0 1"],
          duration: 1180,
          delay: stagger(90, { from: "first" }),
          ease: "inOutQuad",
        }));
      }

      const scan = animate(".loading-scan", {
        translateX: ["-120%", "430%"],
        opacity: [0, 0.8, 0],
        duration: 1760,
        ease: "inOutSine",
        loop: true,
      });
      scanRef.current = scan;
      animationsRef.current.push(scan);
    }

    const handleVisibility = () => {
      animationsRef.current.forEach((animation) => {
        if (document.hidden) animation.pause?.();
        else if (!animation.completed) animation.resume?.();
      });
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(minimumTimer);
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      animationsRef.current.forEach((animation) => animation.revert?.());
      animationsRef.current = [];
      scanRef.current = null;
      document.documentElement.classList.remove("is-loading");
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || dismissed || exitingRef.current || !minimumElapsed || (!ready && !fallbackElapsed)) {
      return undefined;
    }

    exitingRef.current = true;
    scanRef.current?.pause?.();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      document.documentElement.classList.remove("is-loading");
      root.setAttribute("aria-hidden", "true");
      const app = document.getElementById("app-story");
      app?.setAttribute("data-loading-complete", "true");
      app?.dispatchEvent(new CustomEvent(LOADING_COMPLETE_EVENT));
      onComplete();
      setDismissed(true);
    };

    if (reduced) {
      finish();
      return undefined;
    }

    const exit = createTimeline({ defaults: { ease: "inOutQuad" } })
      .add(".loading-scan", {
        opacity: 0,
        duration: 120,
      }, 0)
      .add(".loading-quiet-line", {
        scaleX: [0, 1],
        opacity: [0, 1],
        duration: 380,
        ease: "outExpo",
      }, 20)
      .add(".loading-wave-signal", {
        opacity: [1, 0.18],
        duration: 300,
      }, 70)
      .add(".loading-status-line", {
        opacity: [1, 0],
        translateY: [0, -5],
        duration: 220,
        delay: stagger(28, { from: "last" }),
      }, 210)
      .add(root, {
        opacity: [1, 0],
        duration: 460,
        onComplete: finish,
      }, 390);
    animationsRef.current.push(exit);

    return () => {
      exit.revert?.();
    };
  }, [dismissed, fallbackElapsed, minimumElapsed, onComplete, ready]);

  if (dismissed) return null;

  return (
    <div
      className="loading-screen"
      ref={rootRef}
      role="status"
      aria-live="polite"
      aria-label="Tuliko 製品表示を準備しています"
    >
      <div className="loading-register" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <div className="loading-content">
        <div className="loading-brand" aria-hidden="true">
          <span className="loading-brand-part">
            <img className="loading-brand-logo" src="/assets/brand/tuliko-logo.png" alt="" aria-hidden="true" />
          </span>
        </div>
        <p className="loading-kicker loading-status-line">SPD01 / 静音ワークブース</p>
        <div className="loading-acoustic-track" aria-hidden="true">
          <svg className="loading-wave" viewBox="0 0 520 72" preserveAspectRatio="none">
            <defs>
              <linearGradient id="loading-wave-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--color-wave-red)" />
                <stop offset="0.58" stopColor="var(--color-wave-sage-light)" />
                <stop offset="1" stopColor="var(--color-rule-strong)" />
              </linearGradient>
            </defs>
            <path className="loading-wave-base" d="M0 36H520" />
            <path
              className="loading-wave-signal"
              pathLength="100"
              d="M0 36H48C62 36 64 11 82 11S101 61 120 61 139 19 157 19 176 53 195 53 214 25 232 25 251 47 270 47 289 30 307 30 326 42 345 42 364 33 382 33 401 39 420 39 439 35 457 35 476 37 494 37H520"
            />
          </svg>
          <i className="loading-scan" />
          <i className="loading-quiet-line" />
        </div>
        <div className="loading-copy">
          <p className="loading-status-line">製品表示を準備しています</p>
          <span className="loading-status-line">音が静けさへ変わる、その境界を表示します。</span>
        </div>
      </div>
      <p className="loading-index loading-status-line" aria-hidden="true">
        <span>01</span> 表示準備 / 静音境界
      </p>
    </div>
  );
}
