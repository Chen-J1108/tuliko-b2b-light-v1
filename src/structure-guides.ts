export const STRUCTURE_GUIDE_EVENT = "snapod:structure-guide-targets";

export type StructureGuideId =
  | "roof"
  | "base"
  | "columns"
  | "sidePanel"
  | "frontDoor"
  | "fixedGlass"
  | "acousticPanel"
  | "desk"
  | "carpet"
  | "lighting";

export interface StructureGuideTarget {
  id: StructureGuideId;
  x: number;
  y: number;
  /** Projected bounds of the specific part, relative to the WebGL canvas. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  visible: boolean;
}
