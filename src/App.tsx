import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  List,
} from "@phosphor-icons/react";
import { WebGLStage } from "./components/WebGLStage";
import { LoadingScreen } from "./components/LoadingScreen";
import { initMotionSystem } from "./lib/motion";
import {
  PRODUCT_BOUNDARY_EVENT,
  type ProductScreenBoundary,
} from "./product-boundary";
import { CHAPTER_IDS, SceneDirector, type ChapterId } from "./scene-director";
import {
  STRUCTURE_GUIDE_EVENT,
  type StructureGuideId,
  type StructureGuideTarget,
} from "./structure-guides";

const chapters: Array<{ id: ChapterId; short: string; label: string }> = [
  { id: "hero", short: "TOP", label: "トップ" },
  { id: "structure", short: "構造", label: "製品構造" },
  { id: "acoustic", short: "遮音", label: "ガラスと遮音" },
  { id: "modular", short: "構成", label: "モジュール" },
  { id: "interaction", short: "操作", label: "インタラクション" },
];

const BRAND_NAME = "Tuliko";
const BRAND_LOGO_SRC = "/assets/brand/tuliko-logo.png";
const sitePages = [
  { href: "/about/", label: "Tulikoについて" },
  { href: "/business/", label: "製品・事業" },
  { href: "/cases/", label: "配置検討例" },
  { href: "/news/", label: "更新情報" },
  { href: "/contact/", label: "お問い合わせ" },
] as const;

const partLabels = [
  { id: "lighting", name: "天井照明", x: 85.5, y: 31, mobile: [85, 27], anchor: "right", registerOrder: 0, fallback: [61, 9] },
  { id: "roof", name: "天板", x: 85.5, y: 38.6, mobile: [85, 30], anchor: "right", registerOrder: 1, fallback: [58, 10] },
  { id: "columns", name: "構造支柱", x: 85.5, y: 53.8, mobile: [85, 33], anchor: "right", registerOrder: 3, fallback: [60, 40] },
  { id: "fixedGlass", name: "固定ガラス", x: 24, y: 83.5, mobile: [18, 36], anchor: "left", registerOrder: 2, fallback: [47, 48] },
  { id: "sidePanel", name: "外装パネル", x: 85.5, y: 46.2, mobile: [85, 75], anchor: "right", registerOrder: 2, fallback: [64, 48] },
  { id: "frontDoor", name: "フロントドア", x: 24, y: 79.75, mobile: [18, 78], anchor: "left", registerOrder: 1, fallback: [49, 49] },
  { id: "acousticPanel", name: "吸音パネル", x: 24, y: 87.25, mobile: [18, 81], anchor: "left", registerOrder: 3, fallback: [43, 48] },
  { id: "desk", name: "固定デスク", x: 24, y: 76, mobile: [18, 39], anchor: "left", registerOrder: 0, fallback: [42, 50] },
  { id: "carpet", name: "床カーペット", x: 24, y: 84, mobile: [18, 84], anchor: "left", registerOrder: 4, fallback: [55, 79] },
  { id: "base", name: "床ベース", x: 85.5, y: 61.4, mobile: [85, 42], anchor: "right", registerOrder: 4, fallback: [58, 73] },
] as const;

// Pick stable vertical attachment zones inside tall parts. Their projected
// centers can swap order during explosion (for example the door and side
// panel), which forces otherwise clean dogleg leaders to cross. These ratios
// keep each endpoint on its real part while preserving the authored label
// order through the complete explode/reassemble timeline.
const structureGuideYBias: Record<StructureGuideId, number> = {
  lighting: 0.5,
  roof: 0.5,
  columns: 0.18,
  fixedGlass: 0.24,
  desk: 0.5,
  base: 0.5,
  sidePanel: 0.08,
  frontDoor: 0.56,
  acousticPanel: 0.82,
  carpet: 0.5,
};

const incomingWaves = [
  { y: 20, amplitude: 9.6, energyWidth: 6.4, coreWidth: 1.9, opacity: 0.82 },
  { y: 40, amplitude: 8.3, energyWidth: 5.8, coreWidth: 1.8, opacity: 0.74 },
  { y: 60, amplitude: 11.8, energyWidth: 7.2, coreWidth: 2.1, opacity: 0.9 },
  { y: 80, amplitude: 15.8, energyWidth: 9.2, coreWidth: 2.45, opacity: 1 },
];

const soundLanes = [18, 34, 50, 66, 82] as const;

const incomingWavePath = (y: number, amplitude: number, phase = 1) => (
  `M0 ${y} C24 ${y} 29 ${y} 35 ${y} C42 ${y} 43 ${y - amplitude * phase} 51 ${y - amplitude * phase} C59 ${y - amplitude * phase} 61 ${y + amplitude * phase} 70 ${y + amplitude * phase} C78 ${y + amplitude * phase} 82 ${y - amplitude * phase} 90 ${y - amplitude * phase} C95 ${y - amplitude * phase} 97 ${y} 100 ${y}`
);

const transmittedWavePath = (y: number, amplitude: number) => (
  `M0 ${y} C12 ${y} 16 ${y - amplitude} 28 ${y - amplitude} C40 ${y - amplitude} 44 ${y + amplitude * 0.68} 56 ${y + amplitude * 0.68} C68 ${y + amplitude * 0.68} 72 ${y - amplitude * 0.38} 84 ${y - amplitude * 0.38} C92 ${y - amplitude * 0.38} 96 ${y} 100 ${y}`
);

function Brand() {
  return (
    <a className="brand" href="#hero" aria-label={`${BRAND_NAME} トップへ`}>
      <img className="brand-logo" src={BRAND_LOGO_SRC} alt={BRAND_NAME} />
    </a>
  );
}

function ScrollHeading({ id, lines }: { id: string; lines: string[] }) {
  let characterIndex = 0;
  const accessibleLabel = lines.join("");

  return (
    <h2 id={id} data-scroll-heading aria-label={accessibleLabel}>
      {lines.map((line, lineIndex) => (
        <span className="scroll-title-line" aria-hidden="true" key={`${id}-line-${lineIndex}`}>
          {[...line].map((character) => {
            const index = characterIndex++;
            return (
              <span
                className="scroll-title-char"
                data-copy-char
                key={`${id}-char-${index}`}
              >
                {character === " " ? "\u00a0" : character}
              </span>
            );
          })}
        </span>
      ))}
    </h2>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Brand />
      <nav aria-label="メインナビゲーション">
        <div className="header-page-links">
          {sitePages.map((page) => (
            <a href={page.href} key={page.href}>{page.label}</a>
          ))}
        </div>
        <details className="header-menu">
          <summary><List weight="bold" /> メニュー</summary>
          <div className="header-menu-panel">
            {sitePages.map((page) => (
              <a href={page.href} key={page.href}>{page.label}</a>
            ))}
          </div>
        </details>
        <a className="header-cta" href="#consultation">
          導入相談 <ArrowUpRight weight="bold" />
        </a>
      </nav>
    </header>
  );
}

function AcousticField() {
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return undefined;

    const updateBoundary = (event: Event) => {
      const boundary = (event as CustomEvent<ProductScreenBoundary>).detail;
      if (!boundary || boundary.right <= boundary.left || boundary.bottom <= boundary.top) return;
      const width = boundary.right - boundary.left;
      const height = boundary.bottom - boundary.top;

      field.style.setProperty("--acoustic-shell-left", `${boundary.left.toFixed(2)}px`);
      field.style.setProperty("--acoustic-shell-right", `${boundary.right.toFixed(2)}px`);
      field.style.setProperty("--acoustic-glass-left", `${(boundary.left + width * 0.26).toFixed(2)}px`);
      field.style.setProperty("--acoustic-glass-top", `${(boundary.top + height * 0.09).toFixed(2)}px`);
      field.style.setProperty("--acoustic-glass-width", `${(width * 0.54).toFixed(2)}px`);
      field.style.setProperty("--acoustic-glass-height", `${(height * 0.79).toFixed(2)}px`);
      field.style.setProperty("--acoustic-gate-top", `${(boundary.top + height * 0.1).toFixed(2)}px`);
      field.style.setProperty("--acoustic-gate-height", `${(height * 0.8).toFixed(2)}px`);
    };

    window.addEventListener(PRODUCT_BOUNDARY_EVENT, updateBoundary);
    return () => window.removeEventListener(PRODUCT_BOUNDARY_EVENT, updateBoundary);
  }, []);

  return (
    <div
      id="acoustic-visual"
      className="acoustic-field"
      aria-hidden="true"
      ref={fieldRef}
    >
      <div className="quiet-field-haze quiet-field-haze-left" />
      <div className="acoustic-boundary-gate is-incident">
        <i />
        <span className="is-top" />
        <span className="is-bottom" />
      </div>
      <div className="acoustic-boundary-gate is-transmitted">
        <i />
        <span className="is-top" />
        <span className="is-bottom" />
      </div>

      <div className="volume-meter is-outside">
        <div className="volume-meter-copy"><span>外側音量</span><strong>大</strong></div>
        <div className="volume-meter-bars">
          {Array.from({ length: 5 }, (_, index) => (
            <i
              className="volume-meter-bar is-active"
              key={`outside-volume-${index}`}
              style={{ "--meter-order": index } as React.CSSProperties}
            />
          ))}
        </div>
      </div>

      <svg className="incoming-wave" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="incoming-energy-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-wave-red-dark)" stopOpacity="0.05" />
            <stop offset="0.46" stopColor="var(--color-wave-red)" stopOpacity="0.3" />
            <stop offset="1" stopColor="var(--color-wave-red-warm)" stopOpacity="0.13" />
          </linearGradient>
          <linearGradient id="incoming-core-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-wave-red-dark)" stopOpacity="0.58" />
            <stop offset="0.58" stopColor="var(--color-wave-red)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--color-wave-red-warm)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {incomingWaves.map(({ y, amplitude, energyWidth, coreWidth, opacity }, index) => (
          <g className="incoming-wave-lane wave-motion-lane" key={`incoming-lane-${index}`}>
            <path className="incoming-wave-baseline" d={`M0 ${y} H100`} />
            <path
              className="incoming-wave-energy"
              d={incomingWavePath(y, amplitude)}
              style={{ "--energy-width": `${energyWidth}px`, "--lane-opacity": opacity } as React.CSSProperties}
            />
            <path
              className="incoming-wave-line"
              d={incomingWavePath(y, amplitude)}
              style={{ "--core-width": `${coreWidth}px`, "--lane-opacity": opacity } as React.CSSProperties}
            />
          </g>
        ))}
        <path className="incoming-wave-boundary" d="M99 7 V93" />
      </svg>

      <div className="volume-meter is-transmitted">
        <div className="volume-meter-copy"><span>透過音量</span><strong>小</strong></div>
        <div className="volume-meter-bars">
          {Array.from({ length: 5 }, (_, index) => (
            <i
              className={`volume-meter-bar${index < 2 ? " is-active" : ""}`}
              key={`transmitted-volume-${index}`}
              style={{ "--meter-order": index } as React.CSSProperties}
            />
          ))}
        </div>
      </div>

      <svg className="outgoing-wave" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="outgoing-wave-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-wave-sage-bright)" stopOpacity="0.8" />
            <stop offset="0.58" stopColor="var(--color-wave-sage)" stopOpacity="0.62" />
            <stop offset="1" stopColor="var(--color-wave-sage-muted)" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        {soundLanes.map((y, index) => (
          <g className="outgoing-wave-lane wave-motion-lane" key={`outgoing-lane-${y}`}>
            <path className="outgoing-wave-baseline" d={`M0 ${y} H100`} />
            <path
              className="outgoing-wave-line"
              d={transmittedWavePath(y, 2.2 - index * 0.12)}
              style={{ "--lane-opacity": 0.82 - index * 0.08 } as React.CSSProperties}
            />
            <path
              className="outgoing-wave-flow wave-flow-line"
              d={transmittedWavePath(y, 2.2 - index * 0.12)}
              pathLength={100}
              style={{ "--lane-opacity": 0.82 - index * 0.08 } as React.CSSProperties}
            />
          </g>
        ))}
      </svg>

    </div>
  );
}

function StructureGuides() {
  const rootRef = useRef<HTMLDivElement>(null);
  const productBoundaryRef = useRef<ProductScreenBoundary | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const updateProductBoundary = (event: Event) => {
      productBoundaryRef.current = (event as CustomEvent<ProductScreenBoundary>).detail;
    };

    const updateTargets = (event: Event) => {
      const targets = (event as CustomEvent<StructureGuideTarget[]>).detail;
      const bounds = root.getBoundingClientRect();
      // The WebGL canvas can be translated for the compact layout.  Its
      // projected points are canvas-relative, whereas the annotation layer is
      // viewport-relative; read the rendered canvas boundary so the leaders
      // remain aligned after the compact canvas translation.
      const canvasBounds = document.querySelector<HTMLElement>(".webgl-mount")?.getBoundingClientRect();
      if (!targets || bounds.width <= 0 || bounds.height <= 0) return;

      const isCompact = bounds.width <= 900;
      const resolvedTargets = targets.flatMap((target) => {
        const part = partLabels.find((candidate) => candidate.id === target.id);
        if (!part) return [];

        return [{
          target,
          part,
          targetPixelX: (canvasBounds?.left ?? 0) + target.x - bounds.left,
          targetPixelY: (canvasBounds?.top ?? 0)
            + target.top
            + (target.bottom - target.top) * structureGuideYBias[target.id]
            - bounds.top,
          targetPixelLeft: (canvasBounds?.left ?? 0) + target.left - bounds.left,
          targetPixelRight: (canvasBounds?.left ?? 0) + target.right - bounds.left,
        }];
      });

      if (!isCompact) {
        // An exploded part can briefly pass another part in screen space.
        // Preserve the authored label order at the silhouette edge so two
        // semantic leaders never exchange vertical lanes and intersect.
        (["left", "right"] as const).forEach((side) => {
          let previousY = Number.NEGATIVE_INFINITY;
          partLabels
            .filter((part) => part.anchor === side)
            .sort((a, b) => a.registerOrder - b.registerOrder)
            .forEach((part) => {
              const entry = resolvedTargets.find(({ target }) => target.id === part.id);
              if (!entry) return;
              // The fixed-square target marker is 16px; keep a small visible
              // gap between neighboring markers as well as between leaders.
              entry.targetPixelY = Math.max(entry.targetPixelY, previousY + 20);
              previousY = entry.targetPixelY;
            });
        });
      }
      const labelLayout = new Map<StructureGuideId, {
        x: number;
        y: number;
        laneOffset?: number;
        side?: "left" | "right";
      }>();

      partLabels.forEach((part) => {
        const [x, y] = isCompact ? part.mobile : [part.x, part.y];
        labelLayout.set(part.id, { x, y });
      });

      // Use the model silhouette, rather than the exact anchor point, as the
      // end of every annotation. A visible air gap keeps the technical lines
      // separate from dark panel edges in both assembled and exploded states.
      const guideLeft = Math.min(...resolvedTargets.map(({ targetPixelX }) => targetPixelX));
      const guideRight = Math.max(...resolvedTargets.map(({ targetPixelX }) => targetPixelX));
      const boundary = productBoundaryRef.current;
      const boundaryLeft = boundary ? (canvasBounds?.left ?? 0) + boundary.left - bounds.left : guideLeft;
      const boundaryRight = boundary ? (canvasBounds?.left ?? 0) + boundary.right - bounds.left : guideRight;
      const productClearance = 18;
      const outerLeft = Math.max(0, Math.min(guideLeft, boundaryLeft) - productClearance);
      const outerRight = Math.min(bounds.width, Math.max(guideRight, boundaryRight) + productClearance);
      root.dataset.productLeft = boundaryLeft.toFixed(2);
      root.dataset.productRight = boundaryRight.toFixed(2);
      root.dataset.productTop = (boundary ? (canvasBounds?.top ?? 0) + boundary.top - bounds.top : 0).toFixed(2);
      root.dataset.productBottom = (boundary ? (canvasBounds?.top ?? 0) + boundary.bottom - bounds.top : bounds.height).toFixed(2);

      if (!isCompact) {
        // Keep one fixed, vertically centred annotation register to the right
        // of the product and one fixed register in the lower-left. Product
        // motion updates only the leader geometry, never the text positions.
        const labelGap = Math.max(24, Math.min(48, bounds.width * 0.04));
        const leftLabelX = 23;
        const rightLabelX = 85.5;
        root.dataset.labelGap = labelGap.toFixed(2);
        const groups: Array<{
          side: "left" | "right";
          labelX: number;
          minY: number;
          maxY: number;
        }> = [
          {
            side: "right",
            labelX: rightLabelX,
            // Centre the five structural names against the product rather than
            // stacking them over its roof. This creates a direct, short
            // hand-off from the register to the live semantic edge while the
            // complete column still clears the progress-rail gutter.
            minY: 31,
            maxY: 61.4,
          },
          {
            side: "left",
            labelX: leftLabelX,
            minY: 76,
            maxY: 91,
          },
        ];

        groups.forEach(({ side, labelX, minY, maxY }) => {
          // Keep the authored corner assignment stable while sorting each
          // group by its live vertical target. This makes the leaders readable
          // without letting a part jump to the opposite annotation register.
          const orderedEntries = partLabels
            .filter((part) => part.anchor === side)
            .sort((a, b) => a.registerOrder - b.registerOrder)
            .flatMap((part) => resolvedTargets.filter((entry) => (
              entry.part.id === part.id && entry.target.visible
            )));
          if (!orderedEntries.length) return;
          const rowGap = orderedEntries.length > 1
            ? (maxY - minY) / (orderedEntries.length - 1)
            : 0;
          const rows = orderedEntries.map((_, index) => minY + rowGap * index);

          orderedEntries.forEach(({ target }, index) => {
            labelLayout.set(target.id, {
              x: labelX,
              y: rows[index],
              // Keep the bend between its label register and the live product
              // edge. This prevents an upper diagonal from cutting back
              // through the horizontal rows beneath it.
              laneOffset: side === "left" ? 36 : -36,
              side,
            });
          });
        });
      }

      const semanticEndpointX = new Map<StructureGuideId, number>();
      const partClearance = 10;
      if (!isCompact) {
        resolvedTargets.forEach(({ part, targetPixelLeft, targetPixelRight }) => {
          semanticEndpointX.set(
            part.id,
            part.anchor === "left"
              ? Math.max(0, targetPixelLeft - partClearance)
              : Math.min(bounds.width, targetPixelRight + partClearance),
          );
        });
      }

      const approachPixelX = new Map<"left" | "right", number>();
      const registerKneePixelX = new Map<"left" | "right", number>();
      if (!isCompact) {
        (["left", "right"] as const).forEach((side) => {
          const sideEndpoints = partLabels
            .filter((part) => part.anchor === side)
            .map((part) => semanticEndpointX.get(part.id))
            .filter((value): value is number => value !== undefined);
          if (!sideEndpoints.length) return;
          const labelPixelX = ((side === "left" ? 23 : 85.5) / 100) * bounds.width;
          const desiredRun = Math.max(88, Math.min(160, bounds.width * 0.08));
          const nearestEndpoint = side === "left"
            ? Math.min(...sideEndpoints)
            : Math.max(...sideEndpoints);
          const availableRun = side === "left"
            ? nearestEndpoint - labelPixelX
            : labelPixelX - nearestEndpoint;
          // During the assembled entry some targets sit close to the label
          // register. Contract both shared columns into that free corridor so
          // terminal strokes never fold back across the diagonal bundle.
          const registerRun = Math.max(12, Math.min(desiredRun, availableRun * 0.42));
          const kneePixelX = side === "left"
            ? labelPixelX + registerRun
            : labelPixelX - registerRun;
          registerKneePixelX.set(side, kneePixelX);
          const remainingRun = Math.max(0, side === "left"
            ? nearestEndpoint - kneePixelX
            : kneePixelX - nearestEndpoint);
          approachPixelX.set(
            side,
            side === "left"
              ? kneePixelX + remainingRun * 0.52
              : kneePixelX - remainingRun * 0.52,
          );
        });
      }

      resolvedTargets.forEach(({
        target,
        part,
        targetPixelX,
        targetPixelY,
        targetPixelLeft,
        targetPixelRight,
      }) => {
        const line = root.querySelector<SVGPathElement>(`[data-guide-line="${target.id}"]`);
        const endpoint = root.querySelector<SVGSVGElement>(`[data-guide-endpoint="${target.id}"]`);
        const label = root.querySelector<HTMLElement>(`[data-part-label="${target.id}"]`);
        if (!line) return;

        const layout = labelLayout.get(part.id) ?? { x: part.x, y: part.y, side: part.anchor };
        const { x: labelX, y: labelY, laneOffset, side = part.anchor } = layout;
        const targetX = (targetPixelX / bounds.width) * 640;
        const targetY = (targetPixelY / bounds.height) * 600;
        const startX = (labelX / 100) * 640;
        const startY = (labelY / 100) * 600;
        const elbowX = part.anchor === "right" ? startX - 56 : startX + 56;
        const withinStage = target.visible
          && targetX > 0
          && targetX < 640
          && targetY > 0
          && targetY < 600;

        const opacity = withinStage ? "1" : "0";
        line.style.opacity = opacity;
        endpoint?.style.setProperty("opacity", opacity);
        if (!isCompact && laneOffset !== undefined) {
          // Attach each leader to the outside edge of its own semantic part,
          // not to the union boundary of the whole exploded product. This
          // preserves the authored label registers while making the callout
          // unambiguous at every point in the explode/reassemble sequence.
          const labelPixelX = (labelX / 100) * bounds.width;
          const endpointPixelX = semanticEndpointX.get(part.id) ?? (side === "left"
            ? Math.max(0, targetPixelLeft - partClearance)
            : Math.min(bounds.width, targetPixelRight + partClearance));
          // All leaders on a register share one bend column. With both the
          // label rows and target rows kept in order, this guarantees the
          // diagonals cannot weave through one another while the model moves.
          const kneePixelX = registerKneePixelX.get(side) ?? labelPixelX;
          const endpointX = (endpointPixelX / bounds.width) * 640;
          const kneeX = (kneePixelX / bounds.width) * 640;
          const approachX = ((approachPixelX.get(side) ?? endpointPixelX) / bounds.width) * 640;
          // A common approach column keeps the diagonals ordered. The short
          // terminal segment then lands on the exact semantic part edge.
          line.setAttribute("d", `M${startX} ${startY} H${kneeX} L${approachX} ${targetY} H${endpointX}`);
          endpoint?.style.setProperty("--target-x", `${endpointPixelX}px`);
          endpoint?.style.setProperty("--target-y", `${targetPixelY}px`);
          label?.style.setProperty("--label-y", `${labelY}%`);
          label?.style.setProperty("--label-x", `${labelX}%`);
          label?.classList.toggle("is-left", side === "left");
          label?.classList.toggle("is-right", side === "right");
        } else if (isCompact) {
          const side = part.anchor;
          const exitPixelX = side === "left" ? outerLeft : outerRight;
          const lanePixelX = side === "left" ? exitPixelX - 12 : exitPixelX + 12;
          const mobileLaneX = (lanePixelX / bounds.width) * 640;
          const mobileExitX = (exitPixelX / bounds.width) * 640;
          line.setAttribute("d", `M${startX} ${startY} H${mobileLaneX} V${targetY} H${mobileExitX}`);
          endpoint?.style.setProperty("--target-x", `${exitPixelX}px`);
          endpoint?.style.setProperty("--target-y", `${targetPixelY}px`);
          label?.classList.toggle("is-left", side === "left");
          label?.classList.toggle("is-right", side === "right");
        } else {
          line.setAttribute("d", `M${startX} ${startY} L${elbowX} ${startY} L${targetX} ${targetY}`);
          endpoint?.style.setProperty("--target-x", `${targetPixelX}px`);
          endpoint?.style.setProperty("--target-y", `${targetPixelY}px`);
          label?.style.setProperty("--label-x", `${part.x}%`);
          label?.classList.toggle("is-left", part.anchor === "left");
          label?.classList.toggle("is-right", part.anchor === "right");
        }
      });
    };

    window.addEventListener(PRODUCT_BOUNDARY_EVENT, updateProductBoundary);
    window.addEventListener(STRUCTURE_GUIDE_EVENT, updateTargets);
    return () => {
      window.removeEventListener(PRODUCT_BOUNDARY_EVENT, updateProductBoundary);
      window.removeEventListener(STRUCTURE_GUIDE_EVENT, updateTargets);
    };
  }, []);

  return (
    <div className="structure-guides" aria-hidden="true" ref={rootRef}>
      <svg className="guide-line-layer" viewBox="0 0 640 600" preserveAspectRatio="none">
        {partLabels.map((part) => {
          const startX = (part.x / 100) * 640;
          const startY = (part.y / 100) * 600;
          const targetX = (part.fallback[0] / 100) * 640;
          const targetY = (part.fallback[1] / 100) * 600;
          const elbowX = part.anchor === "right" ? startX - 56 : startX + 56;
          return (
            <path
              className="guide-line"
              data-guide-line={part.id satisfies StructureGuideId}
              d={`M${startX} ${startY} L${elbowX} ${startY} L${targetX} ${targetY}`}
              key={part.id}
            />
          );
        })}
      </svg>
      {partLabels.map((part) => (
        <svg
          className="guide-target-marker"
          data-guide-endpoint={part.id satisfies StructureGuideId}
          viewBox="0 0 16 16"
          key={`endpoint-${part.id}`}
        >
          <circle className="guide-target-ring" cx="8" cy="8" r="5.5" />
          <circle className="guide-target-dot" cx="8" cy="8" r="1.8" />
        </svg>
      ))}
      {partLabels.map((part, index) => (
        <span
          className={`part-label is-${part.anchor}`}
          data-part-label={part.id satisfies StructureGuideId}
          style={{
            "--label-x": `${part.x}%`,
            "--label-y": `${part.y}%`,
            "--mobile-label-x": `${part.mobile[0]}%`,
            "--mobile-label-y": `${part.mobile[1]}%`,
          } as React.CSSProperties}
          key={part.name}
        >
          <b className="part-label-index">{String(index + 1).padStart(2, "0")}</b>
          <span className="part-label-name">{part.name}</span>
        </span>
      ))}
      <div className="mobile-part-index">
        {partLabels.map((part, index) => (
          <span key={`index-${part.id}`}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            {part.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProgressRail() {
  return (
    <nav className="progress-rail" data-progress-rail aria-label="ページ進捗">
      <div className="progress-track">
        <i className="progress-cursor" data-progress-cursor />
        {chapters.map((chapter) => (
          <a
            href={`#${chapter.id}`}
            data-progress-anchor={chapter.id}
            aria-label={chapter.label}
            key={chapter.id}
          >
            <i />
            <span>{chapter.short}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

function HeroTitle() {
  return (
    <h1 id="hero-title">
      静けさを、<br />仕事の中心に。
    </h1>
  );
}

interface SectionContinuationProps {
  target: string;
  index: string;
  label: string;
  detail: string;
  className?: string;
}

function SectionContinuation({ target, index, label, detail, className = "" }: SectionContinuationProps) {
  return (
    <a
      className={`section-continuation ${className}`.trim()}
      href={`#${target}`}
      aria-label={`次のセクション「${label}」へ進む`}
    >
      <span className="continuation-copy">
        <small>NEXT · {index}</small>
        <strong>{label}</strong>
        <em>{detail}</em>
      </span>
      <span className="continuation-signal" aria-hidden="true">
        <i />
      </span>
    </a>
  );
}

function VerifiedTestSection() {
  return (
    <section className="post-story-section verified-test-section" id="measurement" data-next-target="consultation" aria-labelledby="measurement-title">
      <div className="verified-test-heading">
        <p className="post-section-index"><span>08</span> 試験・分類資料</p>
        <h2 id="measurement-title">第三者試験の資料を、<br />そのまま確認できる形で。</h2>
        <p>ここには、ローカルの第三者試験報告書から確認できる測定値と分類のみを掲載します。Web 3D の制作資料、製品仕様書、社内参考資料は含めません。</p>
      </div>

      <div className="evidence-register" aria-label="掲載資料の一覧">
        <article className="evidence-register-item">
          <span>01</span>
          <div><strong>遮音測定報告書</strong><p>SGS Test Report / ISO 23351-1:2020</p></div>
          <em>SPD01 受測サンプル</em>
        </article>
        <article className="evidence-register-item">
          <span>02</span>
          <div><strong>防火分類報告書</strong><p>SGS Test Report / EN 13501-1:2018</p></div>
          <em>PET 吸音パネル単体</em>
        </article>
      </div>

      <div className="evidence-grid">
        <article className="evidence-card evidence-card-primary">
          <div className="evidence-card-copy">
            <p className="evidence-card-index">01 / MEASUREMENT REPORT</p>
            <h3>SPD01 受測サンプルの<br />測定情報。</h3>
            <p>会話音レベル低減 <strong>30.3 dB / Class A</strong> は、SPD01 の受測サンプルに限る測定値です。全 SKU・全構成への性能保証や認証を示すものではありません。</p>
            <dl className="verified-test-facts">
              <div><dt>試験方法</dt><dd>ISO 23351-1:2020（laboratory method）</dd></div>
              <div><dt>受測サンプル</dt><dd>W1000 × D1000 × H2300 mm / SPD01</dd></div>
              <div><dt>報告書</dt><dd>CZIN2605000320CM02_EN / 2026-05-28</dd></div>
              <div><dt>掲載箇所</dt><dd>Speech Level Reduction / Page 3 of 7</dd></div>
            </dl>
            <p className="verified-test-note">採用前の性能・仕様・設置条件は個別にご確認ください。</p>
          </div>
          <a className="evidence-preview evidence-preview-sgs" href="/assets/docs/sgs-spd01-speech-level-reduction-czin2605000320cm02-en.pdf" target="_blank" rel="noreferrer" aria-label="SPD01のSGS測定報告書PDFを開く">
            <img src="/assets/docs/sgs-report-page.webp" alt="SPD01受測サンプルの寸法、ISO 23351-1:2020、30.3 dB、Class A、報告書番号と発行日を記載したSGS試験報告書の3ページ目" loading="lazy" width="1024" height="1448" />
            <span>報告書 PDF を開く <ArrowUpRight weight="bold" /></span>
          </a>
        </article>

        <article className="evidence-card evidence-card-fire">
          <div className="evidence-card-copy">
            <p className="evidence-card-index">02 / FIRE CLASSIFICATION REPORT</p>
            <h3>吸音パネル単体の<br />防火分類資料。</h3>
            <p>白色 PET 吸音パネル（厚さ 9 mm、面密度 1.9 kg/m²）について、SGS 試験報告書に <strong>B-s1,d0</strong> の分類が記載されています。SPD01 全体、他の部材、設置後の防火性能を示すものではありません。</p>
            <dl className="verified-test-facts">
              <div><dt>試験方法</dt><dd>EN 13501-1:2018</dd></div>
              <div><dt>対象試料</dt><dd>White PET acoustic panel / 9 mm / 1.9 kg/m²</dd></div>
              <div><dt>分類</dt><dd>B-s1,d0</dd></div>
              <div><dt>報告書</dt><dd>SHFTS25001088R04_EN / 2026-05-15</dd></div>
            </dl>
            <p className="verified-test-note">結果は受領した試料に限られます。採用可否や適用条件は、設計・法規の確認を含め個別にご判断ください。</p>
          </div>
          <a className="evidence-preview evidence-preview-fire" href="/assets/docs/sgs-fire-classification-pet-acoustic-panel-shfts25001088r04-en.pdf" target="_blank" rel="noreferrer" aria-label="PET吸音パネルのSGS防火分類報告書PDFを開く">
            <img src="/assets/docs/sgs-fire-classification-pet-acoustic-panel-page-1.png" alt="PET吸音パネルの厚さ、面密度、EN 13501-1:2018、B-s1,d0、報告書番号と日付を記載したSGS試験報告書の1ページ目" loading="lazy" width="1191" height="1684" />
            <span>報告書 PDF を開く <ArrowUpRight weight="bold" /></span>
          </a>
        </article>

      </div>
      <SectionContinuation target="consultation" index="09" label="導入条件を相談する" detail="設置場所・人数・納期を整理" />
    </section>
  );
}

function ProductFilmSection() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const pauseWhenHidden = () => {
      if (document.hidden) video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry && (!entry.isIntersecting || entry.intersectionRatio < 0.34)) video.pause();
    }, { threshold: [0, 0.34] });

    observer.observe(video);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      video.pause();
    };
  }, []);

  return (
    <section
      className="post-story-section product-film-section"
      id="product-film"
      data-next-target="product-skus"
      aria-labelledby="product-film-title"
    >
      <div className="product-film-bridge">
        <p className="post-section-index"><span>06</span> 製品映像</p>
        <h2 id="product-film-title">動きを見て、<br />次の一台を選ぶ。</h2>
        <p>製品の組み立ちを映像で確認した後、9つのSKUを正面図と45度ビューで比較できます。</p>
        <SectionContinuation target="product-skus" index="07" label="SKUを比較する" detail="サイズと掲載色を一画面で確認" />
      </div>
      <figure className="product-film">
        <div className="product-film-media">
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            poster="/assets/video/spd01-structure-v5-poster.webp"
          >
            <source src="/assets/video/spd01-structure-locked-v5.mp4" type="video/mp4" />
            お使いのブラウザーでは動画を再生できません。
            <a href="/assets/video/spd01-structure-locked-v5.mp4">製品映像を開く</a>
          </video>
        </div>
      </figure>
    </section>
  );
}

function CompanyProfile() {
  return (
    <section className="company-profile" id="company-info" aria-labelledby="company-profile-title">
      <div className="company-profile-heading">
        <h3 id="company-profile-title">企業・製品情報</h3>
        <span>確認済み情報</span>
      </div>
      <dl>
        <div>
          <dt>ブランド</dt>
          <dd>{BRAND_NAME}</dd>
        </div>
        <div>
          <dt>製品分野</dt>
          <dd>静音ワークブース</dd>
        </div>
        <div>
          <dt>製品</dt>
          <dd>SPD01</dd>
        </div>
        <div>
          <dt>相談窓口</dt>
          <dd><a href="mailto:contact@snapod.jp">contact@snapod.jp</a></dd>
        </div>
      </dl>
      <p>法人名・所在地・電話番号は、正式な会社資料の確認後に掲載します。</p>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer-rich" id="site-footer" aria-label="フッター">
      <div className="footer-main">
        <div className="footer-brand-column">
          <Brand />
          <p>組み替え式 静音ワークブース</p>
          <a className="footer-contact" href="mailto:contact@snapod.jp">
            <span>相談窓口</span>
            contact@snapod.jp
          </a>
        </div>

        <nav className="footer-nav footer-product-nav" aria-label="製品ナビゲーション">
          <h3>製品</h3>
          <div className="footer-link-grid">
            <a href="#hero">SPD01</a>
            <a href="#structure">製品構造</a>
            <a href="#acoustic">ガラスと遮音</a>
            <a href="#modular">モジュール構成</a>
            <a href="#interaction">操作体験</a>
            <a href="#product-film">製品映像</a>
            <a href="#product-skus">製品SKU</a>
          </div>
        </nav>

        <nav className="footer-nav footer-guide-nav" aria-label="ご案内">
          <h3>ご案内</h3>
          <div className="footer-guide-links">
            <a href="#consultation">導入相談</a>
            <a href="/about/">Tulikoについて</a>
            <a href="/business/">製品・事業</a>
            <a href="/cases/">配置検討例</a>
            <a href="/news/">更新情報</a>
            <a href="/contact/">お問い合わせ</a>
          </div>
        </nav>
      </div>

      <div className="footer-bottom">
        <span>© {BRAND_NAME}</span>
        <span>静けさを、仕事の中心に。</span>
        <a href="#hero">ページ上部へ <ArrowUpRight weight="bold" /></a>
      </div>
    </footer>
  );
}

type ProductSku = "SPD01" | "SPD02" | "SPD03" | "SPD04" | "SPD07" | "SPD08" | "SPD09" | "SPD12" | "SPD14";
type ProductColor = "greyGreen" | "earthBrown" | "softRed" | "black" | "white" | "khaki" | "shadowGrey" | "ars" | "gxs" | "glossGrey";

const productColors: Record<ProductColor, { label: string; swatch: string }> = {
  greyGreen: { label: "灰緑", swatch: "#8ea194" },
  earthBrown: { label: "土褐", swatch: "#79675c" },
  softRed: { label: "米紅", swatch: "#b47864" },
  black: { label: "黒", swatch: "#232524" },
  white: { label: "白", swatch: "#dad9d4" },
  khaki: { label: "カーキ", swatch: "#b5aa8c" },
  shadowGrey: { label: "陰影グレー", swatch: "#757a7b" },
  ars: { label: "ARS", swatch: "#a76558" },
  gxs: { label: "GXS", swatch: "#b28a3c" },
  glossGrey: { label: "光沢グレー", swatch: "#aeb4ae" },
};

interface ProductVariant {
  color: ProductColor;
  image: string;
}

interface ProductSkuConfig {
  sku: ProductSku;
  label: string;
  frontImage: string;
  frontColor: ProductColor;
  variants: readonly ProductVariant[];
}

const productSkus: readonly ProductSkuConfig[] = [
  {
    sku: "SPD01",
    label: "一人用・直線デスク",
    frontImage: "/assets/products/catalog-views/spd01-front-grey-green.webp",
    frontColor: "greyGreen",
    variants: [
      { color: "greyGreen", image: "/assets/products/catalog/spd01-grey-green.webp" },
      { color: "earthBrown", image: "/assets/products/catalog/spd01-earth-brown.webp" },
      { color: "softRed", image: "/assets/products/catalog/spd01-soft-red.webp" },
      { color: "black", image: "/assets/products/catalog/spd01-black.webp" },
    ],
  },
  {
    sku: "SPD02",
    label: "一人用・L型デスク",
    frontImage: "/assets/products/catalog-views/spd02-front-white.webp",
    frontColor: "white",
    variants: [
      { color: "white", image: "/assets/products/catalog/spd02-white.webp" },
      { color: "khaki", image: "/assets/products/catalog/spd02-khaki.webp" },
      { color: "shadowGrey", image: "/assets/products/catalog/spd02-shadow-grey.webp" },
    ],
  },
  {
    sku: "SPD03",
    label: "一人用・昇降デスク",
    frontImage: "/assets/products/catalog-views/spd03-front-gloss-grey.webp",
    frontColor: "glossGrey",
    variants: [
      { color: "ars", image: "/assets/products/catalog/spd03-ars.webp" },
      { color: "gxs", image: "/assets/products/catalog/spd03-gxs.webp" },
      { color: "glossGrey", image: "/assets/products/catalog/spd03-gloss-grey.webp" },
    ],
  },
  {
    sku: "SPD04",
    label: "一人用・ラウンジチェア",
    frontImage: "/assets/products/catalog-views/spd04-front-grey-green.webp",
    frontColor: "greyGreen",
    variants: [
      { color: "greyGreen", image: "/assets/products/catalog/spd04-grey-green.webp" },
      { color: "earthBrown", image: "/assets/products/catalog/spd04-earth-brown.webp" },
      { color: "softRed", image: "/assets/products/catalog/spd04-soft-red.webp" },
    ],
  },
  {
    sku: "SPD07",
    label: "二人用・ミーティング",
    frontImage: "/assets/products/catalog-views/spd07-front-white.webp",
    frontColor: "white",
    variants: [
      { color: "white", image: "/assets/products/catalog/spd07-white.webp" },
      { color: "shadowGrey", image: "/assets/products/catalog/spd07-shadow-grey.webp" },
      { color: "black", image: "/assets/products/catalog/spd07-black.webp" },
    ],
  },
  {
    sku: "SPD08",
    label: "二人用・昇降デスク",
    frontImage: "/assets/products/catalog-views/spd08-front-gloss-grey.webp",
    frontColor: "glossGrey",
    variants: [
      { color: "ars", image: "/assets/products/catalog/spd08-ars.webp" },
      { color: "gxs", image: "/assets/products/catalog/spd08-gxs.webp" },
      { color: "glossGrey", image: "/assets/products/catalog/spd08-gloss-grey.webp" },
      { color: "khaki", image: "/assets/products/catalog/spd08-khaki.webp" },
    ],
  },
  {
    sku: "SPD09",
    label: "小型ミーティング",
    frontImage: "/assets/products/catalog-views/spd09-front-white.webp",
    frontColor: "white",
    variants: [
      { color: "ars", image: "/assets/products/catalog/spd09-ars.webp" },
      { color: "gxs", image: "/assets/products/catalog/spd09-gxs.webp" },
      { color: "greyGreen", image: "/assets/products/catalog/spd09-grey-green.webp" },
      { color: "glossGrey", image: "/assets/products/catalog/spd09-gloss-grey.webp" },
      { color: "earthBrown", image: "/assets/products/catalog/spd09-earth-brown.webp" },
      { color: "white", image: "/assets/products/catalog/spd09-white.webp" },
      { color: "softRed", image: "/assets/products/catalog/spd09-soft-red.webp" },
      { color: "khaki", image: "/assets/products/catalog/spd09-khaki.webp" },
      { color: "shadowGrey", image: "/assets/products/catalog/spd09-shadow-grey.webp" },
      { color: "black", image: "/assets/products/catalog/spd09-black.webp" },
    ],
  },
  {
    sku: "SPD12",
    label: "中型ミーティング",
    frontImage: "/assets/products/catalog-views/spd12-front-white.webp",
    frontColor: "white",
    variants: [
      { color: "ars", image: "/assets/products/catalog/spd12-ars.webp" },
      { color: "gxs", image: "/assets/products/catalog/spd12-gxs.webp" },
      { color: "greyGreen", image: "/assets/products/catalog/spd12-grey-green.webp" },
      { color: "glossGrey", image: "/assets/products/catalog/spd12-gloss-grey.webp" },
      { color: "earthBrown", image: "/assets/products/catalog/spd12-earth-brown.webp" },
      { color: "white", image: "/assets/products/catalog/spd12-white.webp" },
      { color: "softRed", image: "/assets/products/catalog/spd12-soft-red.webp" },
      { color: "khaki", image: "/assets/products/catalog/spd12-khaki.webp" },
      { color: "shadowGrey", image: "/assets/products/catalog/spd12-shadow-grey.webp" },
      { color: "black", image: "/assets/products/catalog/spd12-black.webp" },
    ],
  },
  {
    sku: "SPD14",
    label: "大型ミーティング",
    frontImage: "/assets/products/catalog-views/spd14-front-grey-green.webp",
    frontColor: "greyGreen",
    variants: [
      { color: "ars", image: "/assets/products/catalog/spd14-ars.webp" },
      { color: "gxs", image: "/assets/products/catalog/spd14-gxs.webp" },
      { color: "greyGreen", image: "/assets/products/catalog/spd14-grey-green.webp" },
      { color: "glossGrey", image: "/assets/products/catalog/spd14-gloss-grey.webp" },
      { color: "earthBrown", image: "/assets/products/catalog/spd14-earth-brown.webp" },
      { color: "white", image: "/assets/products/catalog/spd14-white.webp" },
      { color: "softRed", image: "/assets/products/catalog/spd14-soft-red.webp" },
      { color: "khaki", image: "/assets/products/catalog/spd14-khaki.webp" },
      { color: "shadowGrey", image: "/assets/products/catalog/spd14-shadow-grey.webp" },
      { color: "black", image: "/assets/products/catalog/spd14-black.webp" },
    ],
  },
] as const;

interface ProductSelection {
  sku: ProductSku;
  color: ProductColor;
}

interface ProductSkuSectionProps {
  selection: ProductSelection;
  onSelect: (selection: ProductSelection) => void;
}

function ProductSkuSection({ selection, onSelect }: ProductSkuSectionProps) {
  const selectedIndex = productSkus.findIndex(({ sku }) => sku === selection.sku);
  const selectedProduct = productSkus[selectedIndex] || productSkus[0];
  const selectedVariant = selectedProduct.variants.find(({ color }) => color === selection.color) || selectedProduct.variants[0];
  const selectedColor = productColors[selectedVariant.color];

  const selectSku = (product: ProductSkuConfig) => {
    onSelect({ sku: product.sku, color: product.variants[0].color });
  };

  return (
    <section
      className="post-story-section product-sku-section"
      id="product-skus"
      data-next-target="measurement"
      aria-labelledby="product-sku-title"
    >
      <div className="product-sku-copy">
        <p className="post-section-index"><span>07</span> 製品SKU</p>
        <h2 id="product-sku-title">9つのSKUを、<br />一画面で比較。</h2>
        <p className="product-sku-lead">製品を選び、各SKUで確認できる掲載色を切り替えられます。</p>
        <div className="product-sku-current" aria-live="polite">
          <span>選択中</span>
          <strong>{selectedProduct.sku}</strong>
          <small>{selectedProduct.label} ・ {selectedColor.label} ・ 掲載画像 {String(selectedIndex + 1).padStart(2, "0")} / {String(productSkus.length).padStart(2, "0")}</small>
        </div>
        <p className="product-price">¥---,---（価格確認中）</p>
        <SectionContinuation target="measurement" index="08" label="試験資料を確認する" detail="測定値と分類を原資料で確認" />
      </div>

      <div className="product-sku-viewer">
        <div className="product-sku-stage-column">
          <div className="product-sku-stage" aria-live="polite">
            <img
              className="product-sku-stage-image"
              key={`${selectedProduct.sku}-${selectedVariant.color}`}
              src={selectedVariant.image}
              alt={`${selectedProduct.sku} ${selectedColor.label} 45度製品全体画像`}
              width="1600"
              height="1600"
            />
            <div className="product-sku-stage-label" aria-hidden="true">
              <span>{String(selectedIndex + 1).padStart(2, "0")}</span>
              <strong>{selectedProduct.sku}</strong>
              <em>45° VIEW</em>
            </div>
          </div>
          <fieldset className="product-color-selector">
            <div className="product-color-heading">
              <legend>カラー</legend>
              <span>SKU別の掲載色</span>
            </div>
            <div className="product-color-options">
              {selectedProduct.variants.map(({ color }) => {
                const colorInfo = productColors[color];
                return (
                  <label className="product-color-option" key={`${selectedProduct.sku}-${color}`}>
                    <input
                      type="radio"
                      name="product-color-showcase"
                      value={color}
                      checked={selectedVariant.color === color}
                      onChange={() => onSelect({ sku: selectedProduct.sku, color })}
                    />
                    <span className="product-color-option-body">
                      <i style={{ backgroundColor: colorInfo.swatch }} aria-hidden="true" />
                      <span>{colorInfo.label}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        <fieldset className="product-sku-selector">
          <legend className="sr-only">表示する製品SKU</legend>
          <div className="product-sku-options">
            {productSkus.map((product, index) => (
              <label className="product-sku-option" key={product.sku}>
                <input
                  type="radio"
                  name="product-sku-showcase"
                  value={product.sku}
                  checked={selection.sku === product.sku}
                  onChange={() => selectSku(product)}
                />
                <span className="product-sku-option-body">
                  <span className="product-sku-option-image">
                    <img
                      src={product.frontImage}
                      alt={`${product.sku} ${productColors[product.frontColor].label} 正面製品全体画像`}
                      width="1264"
                      height="1600"
                      loading="lazy"
                    />
                    <small aria-hidden="true">正面</small>
                  </span>
                  <span className="product-sku-option-code">
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <strong>{product.sku}</strong>
                    <small>{product.label}</small>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function ConsultationForm({ selection }: { selection: ProductSelection }) {
  const [status, setStatus] = useState("");
  const selectedColor = productColors[selection.color];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const company = value("company");
    const name = value("name");
    const email = value("email");
    const inquiry = value("inquiry");
    const details = value("details");
    const product = value("product") || "SPD01";
    const productColor = value("productColor") || productColors.greyGreen.label;
    const subject = `[${BRAND_NAME} 導入相談] ${product}・${productColor} / ${inquiry} / ${company}`;
    const body = [
      `${BRAND_NAME} 導入相談`,
      "",
      `ご相談製品：${product}`,
      `参考カラー：${productColor}`,
      `会社・組織名：${company}`,
      `お名前：${name}`,
      `メールアドレス：${email}`,
      `ご相談内容：${inquiry}`,
      "",
      "詳細：",
      details,
    ].join("\n");

    setStatus("メールの下書き内容を整えました。メールアプリで宛先と内容を確認してから送信してください。");
    window.location.href = `mailto:contact@snapod.jp?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form id="consultation-form" className="consultation-form" onSubmit={handleSubmit} aria-describedby="consultation-form-note">
      <input type="hidden" name="product" value={selection.sku} />
      <input type="hidden" name="productColor" value={selectedColor.label} />
      <div className="form-product-summary">
        <span>相談製品</span>
        <strong>{selection.sku} ・ {selectedColor.label}</strong>
        <a href="#product-skus">変更</a>
      </div>
      <div className="form-heading">
        <h3>相談内容</h3>
        <span><i aria-hidden="true" /> 必須項目</span>
      </div>

      <div className="form-field-grid">
        <label>
          <span>会社・組織名 <i aria-hidden="true" /></span>
          <input name="company" type="text" autoComplete="organization" required />
        </label>
        <label>
          <span>お名前 <i aria-hidden="true" /></span>
          <input name="name" type="text" autoComplete="name" required />
        </label>
      </div>

      <div className="form-field-grid form-field-grid-secondary">
        <label>
          <span>メールアドレス <i aria-hidden="true" /></span>
          <input name="email" type="email" inputMode="email" autoComplete="email" required />
        </label>

        <label>
          <span>ご相談内容 <i aria-hidden="true" /></span>
          <select name="inquiry" defaultValue="" required>
            <option value="" disabled>選択してください</option>
            <option value="導入相談">導入相談</option>
            <option value="見積・納期">見積・納期</option>
            <option value="搬入・設置">搬入・設置</option>
            <option value="製品仕様">製品仕様</option>
            <option value="その他">その他</option>
          </select>
        </label>
      </div>

      <label>
        <span>詳細 <i aria-hidden="true" /></span>
        <textarea name="details" rows={3} required />
      </label>

      <div className="form-submit-row">
        <p id="consultation-form-note">ボタンを押すと、入力内容を入れたメールの下書きを開きます。このページには保存されません。</p>
        <button className="form-submit" type="submit">
          メールアプリで下書きを開く <ArrowUpRight weight="bold" />
        </button>
      </div>
      <p className="form-status" aria-live="polite">{status}</p>
    </form>
  );
}

function ConsultationSection({ selection }: { selection: ProductSelection }) {
  return (
    <section className="post-story-section consultation-section" id="consultation" aria-labelledby="consultation-title">
      <div className="consultation-layout">
        <div className="consultation-intro">
          <p className="post-section-index"><span>09</span> 導入相談</p>
          <h2 id="consultation-title">空間と使い方から、<br />導入を考える。</h2>
          <p className="consultation-lead">設置場所、利用人数、納期など、現在決まっている範囲でお知らせください。</p>
          <CompanyProfile />
        </div>
        <div className="consultation-action-column">
          <ConsultationForm selection={selection} />
        </div>
      </div>
      <SiteFooter />
    </section>
  );
}

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const director = useMemo(() => new SceneDirector(), []);
  const [stageReady, setStageReady] = useState(false);
  const [loadingComplete, setLoadingComplete] = useState(false);
  const [productSelection, setProductSelection] = useState<ProductSelection>({ sku: "SPD01", color: "greyGreen" });
  const handleStageReady = useCallback(() => setStageReady(true), []);
  const handleLoadingComplete = useCallback(() => setLoadingComplete(true), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return initMotionSystem(root, director);
  }, [director]);

  useEffect(() => {
    const root = rootRef.current;
    const postStory = root?.querySelector<HTMLElement>(".product-film-section");
    if (!root || !postStory) return undefined;
    let frame = 0;

    const updatePostStoryState = () => {
      frame = 0;
      const rect = postStory.getBoundingClientRect();
      root.classList.toggle("is-post-story", rect.top <= window.innerHeight * 0.42);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updatePostStoryState);
    };

    updatePostStoryState();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove("is-post-story");
    };
  }, []);

  return (
    <div
      className="app"
      id="app-story"
      ref={rootRef}
      data-loading-complete={loadingComplete ? "true" : "false"}
      aria-busy={!loadingComplete}
    >
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <WebGLStage director={director} onReady={handleStageReady} />
      <LoadingScreen ready={stageReady} onComplete={handleLoadingComplete} />
      <p className="sr-only" id="product-visual-description">
        {BRAND_NAME} 静音ワークブースの外観と、構造・遮音・モジュール構成を連続して示す三次元表示。
      </p>
      <div className="stage-overlay">
        <AcousticField />
        <StructureGuides />
      </div>
      <Header />

      <main id="main-content">
        <section
          className="story-section hero-section"
          id="hero"
          data-chapter="hero"
          data-next-target="structure"
          aria-labelledby="hero-title"
        >
          <div className="section-sticky hero-layout">
            <div className="hero-copy">
              <p className="hero-kicker"><span>01</span> 組み替え式 静音ワークブース</p>
              <HeroTitle />
          <p className="hero-lead">
                {['集中と会話を守る、', '組み替え可能な', '静音ワークブース。'].map((word) => (
                  <span className="lead-word" key={word}>{word}</span>
                ))}
          </p>
              <p className="hero-product-note"><strong>SPD01</strong>　受測サンプル：W1000 × D1000 × H2300 mm　<a href="#consultation">見積もり・設置条件を相談する</a></p>
              <SectionContinuation className="continuation-desktop" target="structure" index="02" label="製品構造を見る" detail="10の主要部材を分解表示" />
            </div>
            <SectionContinuation className="continuation-mobile" target="structure" index="02" label="製品構造を見る" detail="10の主要部材を分解表示" />
          </div>
        </section>

        <section
          className="story-section structure-section"
          id="structure"
          data-chapter="structure"
          data-next-target="acoustic"
          aria-labelledby="structure-title"
        >
          <div className="section-sticky chapter-layout chapter-left">
            <div className="chapter-copy">
              <p className="structure-kicker"><span>02</span> 製品構造 / COMPONENT MAP</p>
              <h2 id="structure-title">静けさを支える、<br />10の主要構成。</h2>
              <p>実際のSPD01モデルに沿って、主要部材の位置と構成を表示します。</p>
              <SectionContinuation className="continuation-desktop" target="acoustic" index="03" label="遮音性能を確かめる" detail="第三者試験の測定値へ" />
            </div>
            <SectionContinuation className="continuation-mobile" target="acoustic" index="03" label="遮音性能を確かめる" detail="第三者試験の測定値へ" />
            <div className="part-legend" aria-label="製品部品一覧">
              {partLabels.map((part) => <span key={part.name}>{part.name}</span>)}
            </div>
          </div>
        </section>

        <section
          className="story-section acoustic-section"
          id="acoustic"
          data-chapter="acoustic"
          data-next-target="modular"
          aria-labelledby="acoustic-title"
        >
          <div className="section-sticky chapter-layout chapter-left">
            <div className="chapter-copy acoustic-reference-copy">
              <p className="acoustic-kicker"><span>03</span> 第三者試験　/　SPD01 受測サンプル</p>
              <ScrollHeading id="acoustic-title" lines={["音は、境界で", "小さくなる。"]} />
              <p>SPD01 W1000 × D1000 × H2300 mm の受測サンプルは、ISO 23351-1:2020 に基づく実験室測定で 30.3 dB / Class A。SGS 報告書 CZIN2605000320CM02_EN（2026年5月28日発行）で確認できます。</p>
              <p className="acoustic-spec"><a href="#measurement">第三者試験資料を見る</a></p>
              <SectionContinuation className="continuation-desktop" target="modular" index="04" label="空間構成を見る" detail="移設と再組立ての考え方へ" />
            </div>
            <SectionContinuation className="continuation-mobile" target="modular" index="04" label="空間構成を見る" detail="移設と再組立ての考え方へ" />
          </div>
        </section>

        <section
          className="story-section modular-section"
          id="modular"
          data-chapter="modular"
          data-next-target="interaction"
          aria-labelledby="modular-title"
        >
          <div className="section-sticky chapter-layout chapter-left">
            <div className="chapter-copy">
              <p className="story-kicker"><span>04</span> 空間構成</p>
              <ScrollHeading id="modular-title" lines={["変化する空間に、", "組み直して応える。"]} />
              <p>主要部材をグループ化し、構成順序を保った再組立てに対応。移設やレイアウト変更を想定した構成です。</p>
              <p className="chapter-evidence"><strong>SPD01 基準寸法</strong> W1000 × D1000 × H2300 mm</p>
              <SectionContinuation className="continuation-desktop" target="interaction" index="05" label="扉と操作を見る" detail="使い始めるまでの動作へ" />
            </div>
            <SectionContinuation className="continuation-mobile" target="interaction" index="05" label="扉と操作を見る" detail="使い始めるまでの動作へ" />
          </div>
        </section>

        <section
          className="story-section interaction-section"
          id="interaction"
          data-chapter="interaction"
          data-next-target="product-film"
          aria-labelledby="interaction-title"
        >
          <div className="section-sticky chapter-layout chapter-left">
            <div className="chapter-copy">
              <p className="story-kicker"><span>05</span> 扉と操作点</p>
              <ScrollHeading id="interaction-title" lines={["扉を閉じて、", "静けさへ戻る。"]} />
              <p>フロントドアを閉じると外部の音を抑え、固定デスクで作業へ戻れる静かな環境をつくります。</p>
              <p className="chapter-evidence"><strong>操作点</strong> フロントドア / 固定デスク</p>
              <SectionContinuation className="continuation-desktop" target="product-film" index="06" label="製品映像を見る" detail="構造の動きを映像で確認" />
            </div>
            <SectionContinuation className="continuation-mobile" target="product-film" index="06" label="製品映像を見る" detail="構造の動きを映像で確認" />
          </div>
        </section>

        <ProductFilmSection />
        <ProductSkuSection selection={productSelection} onSelect={setProductSelection} />
        <VerifiedTestSection />
        <ConsultationSection selection={productSelection} />
      </main>

      <ProgressRail />
      <div className="sr-only" aria-live="polite" data-chapter-announcer>
        {CHAPTER_IDS[0]}
      </div>
    </div>
  );
}
