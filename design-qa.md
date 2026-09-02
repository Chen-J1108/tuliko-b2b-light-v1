**Design QA — transmitted wave motion**

- Source visual truth: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-2f8979b2-5d17-4f5d-9b45-e1ed5cd591f2.png`
- Implementation screenshots:
  - `D:\New project 2\tuliko-b2b-light-v1\design-qa-outgoing-wave-phase-a.png`
  - `D:\New project 2\tuliko-b2b-light-v1\design-qa-outgoing-wave-phase-b.png`
- Source pixels: 1229 × 499.
- Implementation pixels: 1139 × 768; CSS viewport 1154 × 778 at device scale 1.
- Density normalization: all artifacts are native 1×. The source is a cropped hero region, so comparison used the shared product/right-wave region and two browser-rendered animation phases rather than browser-edge alignment.
- State: homepage hero, normal motion preference, phase samples separated by 1.2 seconds.

**Full-view comparison evidence**

- The source identifies the five sage transmitted waves behind the booth as the requested animated region.
- The implementation preserves the existing hero layout, copy, product scale, wave count, meter, muted sage palette, and quiet visual hierarchy.
- Two rendered phase captures show the same stable composition with different outgoing-wave amplitudes; the booth, copy, and wave endpoints do not move.

**Focused region comparison evidence**

- Five `.outgoing-wave-lane` groups and five `.outgoing-wave-flow` paths are present.
- Browser samples taken 0.9–1.2 seconds apart show every lane's Anime.js `scaleY` and opacity values changing.
- Computed transforms remain pure vertical-scale matrices with zero X/Y translation, so both horizontal endpoints stay locked to the product boundary.
- Directional highlights advance through different `stroke-dashoffset` values. The final cycle travels exactly one 100-unit dash pattern (`12 → -88`), eliminating a visible loop seam.

**Findings**

- No actionable P0, P1, or P2 differences remain for the requested transmitted-wave motion.
- Fonts and typography: no text, hierarchy, wrapping, or meter-copy styling changed.
- Spacing and layout rhythm: the outgoing field keeps its existing measured product-boundary placement and does not enter the product or progress rail.
- Colors and visual tokens: the established sage gradient remains; only the moving highlight receives a restrained visibility increase.
- Image quality and asset fidelity: the authoritative SPD01 product imagery and WebGL stage remain unchanged.
- Copy and content: all Japanese hero and qualitative meter copy remain unchanged.
- Behavior and accessibility: the five lanes use a slow staggered 4.3-second amplitude phrase plus a 3.8-second directional highlight. Existing page-visibility pause and reduced-motion static fallback remain intact.

**Comparison history**

1. Earlier P2 finding: the outgoing wave used only a 0.94–1.06 scale range, making the animation effectively invisible at normal page scale.
2. Fix: replaced it with a restrained five-keyframe 0.58–1.48 breathing phrase, staggered the five lanes, slowed the directional pass, strengthened its short highlight, and aligned the loop by one exact dash period.
3. Post-fix evidence: consecutive browser samples show distinct scale, opacity, and dash-offset values on all five lanes while the layout and endpoints remain stationary.

**Primary interactions tested**

- Direct homepage hero load.
- Continuous multi-sample observation across more than one animation phase.
- All five lane amplitudes and all five directional highlights.
- Stable product, copy, wave-container, and endpoint placement.
- Browser console checked: zero errors.

**Implementation Checklist**

- [x] Animate all five transmitted waves.
- [x] Keep the motion slower and quieter than the incident red field.
- [x] Preserve fixed endpoints with no horizontal travel.
- [x] Eliminate the loop restart jump.
- [x] Preserve visibility pause and reduced-motion fallback.
- [x] Verify production build and all seven Sites tests.

**Follow-up Polish**

- P3 test gap: the reduced-motion branch was preserved by inspection but was not separately captured under an emulated OS preference in the current browser surface.

final result: passed
