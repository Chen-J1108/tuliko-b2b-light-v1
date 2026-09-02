import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Points,
  PointsMaterial,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { SceneDirector } from "../scene-director";
import { clamp01, rangeProgress, smoothstep } from "../scene-director";
import {
  PRODUCT_BOUNDARY_EVENT,
  type ProductScreenBoundary,
} from "../product-boundary";
import {
  STRUCTURE_GUIDE_EVENT,
  type StructureGuideId,
  type StructureGuideTarget,
} from "../structure-guides";

const MODEL_URL = "/assets/models/snapod-spd01-authoritative.glb?v=20260819-1";
const PRODUCT_BOUNDARY_SIGNS = [-0.5, 0.5] as const;

type PartKind =
  | "roof"
  | "base"
  | "columns"
  | "sidePanels"
  | "frontDoor"
  | "rearGlass"
  | "acousticPanels";

interface ExplodablePart {
  object: Object3D;
  base: Vector3;
  direction: Vector3;
  kind: PartKind;
  moduleId: string;
}

interface GuideAnchor {
  object: Object3D;
  localPoint: Vector3;
  localBounds: Box3;
}

interface WebGLStageProps {
  director: SceneDirector;
  onReady?: (status: "loaded" | "error") => void;
}

const PRODUCT_FINISH = {
  // Calibrated against the approved SPD01 hero image: a muted, deep olive
  // shell with charcoal acoustic felt, rather than the washed-out mint that
  // the CAD material produced under the studio environment.
  sage: new Color(0x4d6a54),
  charcoal: new Color(0x111615),
  graphite: new Color(0x303634),
  textile: new Color(0x3e4541),
  glass: new Color(0xc2d7d2),
  desk: new Color(0xd9ddd8),
  light: new Color(0xeef8f5),
};

function partKindForModule(moduleId: string): PartKind {
  switch (moduleId) {
    case "roof":
      return "roof";
    case "base":
    case "carpet":
      return "base";
    case "rear-wall":
      return "acousticPanels";
    case "service-wall":
      return "sidePanels";
    case "fixed-glass":
      return "rearGlass";
    case "door-leaf":
      return "frontDoor";
    default:
      return "columns";
  }
}

function directionForModule(moduleId: string) {
  switch (moduleId) {
    case "roof":
      return new Vector3(0, 0.78, 0);
    case "base":
    case "carpet":
      return new Vector3(0, -0.38, 0.16);
    case "rear-wall":
      return new Vector3(0, 0, -0.76);
    case "service-wall":
      return new Vector3(0.68, 0.02, 0.34);
    case "fixed-glass":
      return new Vector3(-0.72, 0.02, 0.12);
    case "door-leaf":
      return new Vector3(-0.82, 0, -0.32);
    case "door-jamb":
      return new Vector3(-0.44, 0, -0.08);
    case "column-covers":
      return new Vector3(0.36, 0.08, 0.28);
    default:
      return new Vector3(0, 0.42, 0);
  }
}

/**
 * The CAD export keeps a small service clearance beneath the roof module.
 * It is useful in manufacturing data, but reads as an unfinished joint in a
 * presentation render. Keep the exploded offsets intact while closing that
 * clearance in the assembled pose.
 */
function assemblyCorrectionForModule(moduleId: string) {
  switch (moduleId) {
    case "roof":
      return new Vector3(0, -0.042, 0);
    default:
      return new Vector3();
  }
}

function isDeskSurface(bounds: Box3) {
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  return size.x > 0.45
    && size.x < 0.82
    && size.z > 0.18
    && size.z < 0.52
    && size.y < 0.09
    && center.y > -0.35
    && center.y < 0.45;
}

function isCeilingLight(bounds: Box3) {
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  return size.x > 0.24
    && size.x < 0.8
    && size.y < 0.08
    && size.z < 0.14
    && center.y > 0.82;
}

function applyProductFinish(mesh: Mesh) {
  const moduleId = String(mesh.userData?.moduleId || "");
  const partId = String(mesh.userData?.partId || "");
  const bounds = new Box3().setFromObject(mesh);
  const deskSurface = isDeskSurface(bounds);
  const ceilingLight = isCeilingLight(bounds);
  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  const finishedMaterials = sourceMaterials.map((sourceMaterial) => {
    const material = sourceMaterial.clone() as MeshStandardMaterial | MeshPhysicalMaterial;
    const materialName = sourceMaterial.name || "";
    const glassSurface = materialName.includes("Glass");
    const doorGlassSurface = glassSurface && moduleId === "door-leaf";
    const outerSkin = partId.endsWith("outer-skin");
    const innerSkin = partId.endsWith("inner-skin");
    const blackHardware = materialName.includes("BlackHardware");
    const doorFrameAssembly = ["frame-core", "door-jamb", "door-leaf"].includes(moduleId);

    if (glassSurface) {
      const glass = material as MeshPhysicalMaterial;
      glass.color.copy(PRODUCT_FINISH.glass);
      if (doorGlassSurface) glass.color.lerp(PRODUCT_FINISH.graphite, 0.14);
      glass.roughness = doorGlassSurface ? 0.16 : 0.1;
      glass.metalness = 0;
      glass.transmission = 0.95;
      glass.opacity = doorGlassSurface ? 0.045 : 0.075;
      glass.transparent = true;
      glass.depthWrite = false;
      glass.side = DoubleSide;
      glass.clearcoat = doorGlassSurface ? 0.08 : 0.32;
      glass.clearcoatRoughness = doorGlassSurface ? 0.48 : 0.2;
      glass.envMapIntensity = doorGlassSurface ? 0.035 : 0.08;
      glass.ior = 1.45;
      glass.thickness = 0.008;
    } else if (ceilingLight) {
      material.color.copy(PRODUCT_FINISH.light);
      material.emissive.copy(PRODUCT_FINISH.light);
      material.emissiveIntensity = 1.4;
      material.roughness = 0.24;
      material.metalness = 0;
    } else if (deskSurface) {
      material.color.copy(PRODUCT_FINISH.desk);
      material.roughness = 0.34;
      material.metalness = 0.02;
    } else if (outerSkin || moduleId === "column-covers") {
      material.color.copy(PRODUCT_FINISH.sage);
      material.map = null;
      material.emissive.set(0x000000);
      material.emissiveIntensity = 0;
      material.roughness = 0.66;
      material.metalness = 0.02;
      material.envMapIntensity = 0.18;
    } else if (innerSkin) {
      material.color.copy(PRODUCT_FINISH.textile);
      material.roughness = 0.96;
      material.metalness = 0;
      material.envMapIntensity = 0.12;
    } else if (moduleId === "carpet") {
      material.color.copy(PRODUCT_FINISH.graphite);
      material.roughness = 0.96;
      material.metalness = 0;
    } else if (blackHardware) {
      material.color.copy(PRODUCT_FINISH.charcoal);
      material.roughness = 0.46;
      material.metalness = 0.28;
      material.envMapIntensity = 0.14;
    } else if (doorFrameAssembly) {
      // The bright PMREM strip was reading as a white cutout fringe along the
      // front door opening. The real frame is a low-sheen charcoal extrusion,
      // so keep its environment response broad and dark instead of metallic.
      material.color.copy(PRODUCT_FINISH.charcoal);
      material.map = null;
      material.emissive.set(0x000000);
      material.emissiveIntensity = 0;
      material.roughness = 0.78;
      material.metalness = 0.03;
      material.envMapIntensity = 0.045;
    } else if (moduleId === "base") {
      material.color.copy(PRODUCT_FINISH.charcoal);
      material.roughness = 0.5;
      material.metalness = 0.16;
      material.envMapIntensity = 0.12;
    } else if (["rear-wall", "service-wall"].includes(moduleId)) {
      material.color.copy(PRODUCT_FINISH.textile);
      material.roughness = 0.88;
      material.metalness = 0.01;
      material.envMapIntensity = 0.12;
    } else {
      material.color.lerp(PRODUCT_FINISH.graphite, 0.5);
      material.roughness = Math.max(material.roughness, 0.48);
      material.metalness = Math.min(material.metalness, 0.18);
    }

    material.needsUpdate = true;
    return material;
  });

  mesh.material = Array.isArray(mesh.material) ? finishedMaterials : finishedMaterials[0];
}

function createParticles(count: number) {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963;
    const radius = 1.2 + ((index * 83) % 240) / 100;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = -1.1 + ((index * 137) % 250) / 100;
    positions[index * 3 + 2] = Math.sin(angle) * radius * 0.5;
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0x9ba7a3,
    size: 0.009,
    transparent: true,
    opacity: 0.13,
    sizeAttenuation: true,
    depthWrite: false,
  });
  return new Points(geometry, material);
}

function disposeObject(object: Object3D) {
  const disposedMaterials = new Set<object>();
  const disposedTextures = new Set<object>();
  object.traverse((child) => {
    const mesh = child as Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.filter(Boolean).forEach((material) => {
      if (disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      Object.values(material).forEach((value) => {
        if (value && typeof value === "object" && "isTexture" in value && !disposedTextures.has(value)) {
          disposedTextures.add(value);
          (value as { dispose: () => void }).dispose();
        }
      });
      material.dispose?.();
    });
  });
}

function sampleShift(narrative: number) {
  const values = [-0.7, -0.48, -0.46, -0.02, -0.42, -0.42];
  const index = Math.min(values.length - 2, Math.max(0, Math.floor(narrative)));
  const progress = smoothstep(narrative - index);
  return values[index] + (values[index + 1] - values[index]) * progress;
}

function sampleCompactY(narrative: number) {
  const values = [-0.3, -0.1, -0.08, 0.06, 0.06, 0.06];
  const index = Math.min(values.length - 2, Math.max(0, Math.floor(narrative)));
  const progress = smoothstep(narrative - index);
  return values[index] + (values[index + 1] - values[index]) * progress;
}

function sampleMobileDistance(narrative: number) {
  const values = [2.45, 2.28, 2.28, 2.72, 2.72, 2.72];
  const index = Math.min(values.length - 2, Math.max(0, Math.floor(narrative)));
  const progress = smoothstep(narrative - index);
  return values[index] + (values[index + 1] - values[index]) * progress;
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function explosionFor(narrative: number) {
  if (narrative < 1) return 0;
  if (narrative < 1.38) return smoothstep(rangeProgress(narrative, 1, 1.38));
  if (narrative < 1.78) return 1;
  // Complete the reassembly inside the structure chapter. Leaving an 8%
  // residual separation into the next chapter visibly detached the roof.
  if (narrative < 2) return 1 - smoothstep(rangeProgress(narrative, 1.78, 2));
  return 0;
}

export function WebGLStage({ director, onReady }: WebGLStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let animationFrame = 0;
    let lastRenderTime = 0;
    let requestRender = () => undefined;
    let product: Group | null = null;
    let productSize = new Vector3(1.0481, 2.3196, 1);
    const parts: ExplodablePart[] = [];
    const guideAnchors = new Map<StructureGuideId, GuideAnchor>();
    const projectedBoundaryCorner = new Vector3();
    let lastGuideSignature = "";
    let lastBoundarySignature = "";

    const scene = new Scene();
    // Keep the canvas transparent so every 3D chapter inherits the exact
    // warm-white page surface instead of a tone-mapped approximation.
    scene.background = null;
    const camera = new PerspectiveCamera(28, 1, 0.02, 80);
    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: !director.snapshot.compact,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0xfaf7f1, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, director.snapshot.compact ? 1 : 1.25));
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environmentTarget = pmrem.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    room.dispose();
    pmrem.dispose();

    const ambient = new AmbientLight(0xf6f1e8, 0.42);
    const hemisphere = new HemisphereLight(0xfffbf4, 0xd8cdc0, 0.68);
    const key = new DirectionalLight(0xfffaf1, 0.5);
    key.position.set(-3.1, 4.3, 3.5);
    const fill = new DirectionalLight(0xb9c9b9, 0.28);
    fill.position.set(3.4, 1.2, 2.2);
    const rim = new DirectionalLight(0xc3d4c5, 0.42);
    rim.position.set(-2.8, 2.8, -3.2);
    const studioLightPalette = {
      ambient: new Color(0xf6f1e8),
      sky: new Color(0xfffbf4),
      ground: new Color(0xd8cdc0),
      key: new Color(0xfffaf1),
      fill: new Color(0xb9c9b9),
      rim: new Color(0xc3d4c5),
    };
    const spatialLightPalette = {
      ambient: new Color(0xfff0dc),
      sky: new Color(0xfff4e7),
      ground: new Color(0xc8baa6),
      key: new Color(0xffe8ca),
      fill: new Color(0xc7bba6),
      rim: new Color(0xd3d9ca),
    };
    const interiorTarget = new Object3D();
    const interiorGlow = new SpotLight(0xe8f7f4, 0, 5, Math.PI * 0.24, 0.74, 1.3);
    interiorGlow.position.set(-0.18, 1.18, 0.28);
    interiorTarget.position.set(-0.08, -0.3, 0);
    interiorGlow.target = interiorTarget;
    scene.add(ambient, hemisphere, key, fill, rim, interiorGlow, interiorTarget);

    const particles = createParticles(director.snapshot.compact ? 24 : 72);
    scene.add(particles);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, director.snapshot.compact ? 1 : 1.25));
      renderer.setSize(width, height, false);
      requestRender();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        product = new Group();
        product.name = "SNAPOD SPD01 authoritative continuous product stage";
        product.add(gltf.scene);
        scene.add(product);

        const semanticParts = new Map<string, Object3D>();
        let deskTarget: Mesh | null = null;
        let deskTargetArea = 0;
        let lightTarget: Mesh | null = null;
        let lightTargetArea = 0;

        gltf.scene.traverse((child) => {
          const partId = String(child.userData?.partId || "");
          if (partId && !semanticParts.has(partId)) semanticParts.set(partId, child);
          if (!(child as Mesh).isMesh) return;

          const mesh = child as Mesh;
          const bounds = new Box3().setFromObject(mesh);
          const size = bounds.getSize(new Vector3());
          const area = size.x * size.z;
          if (isDeskSurface(bounds) && area > deskTargetArea) {
            deskTarget = mesh;
            deskTargetArea = area;
          }
          if (isCeilingLight(bounds) && area > lightTargetArea) {
            lightTarget = mesh;
            lightTargetArea = area;
          }
          applyProductFinish(mesh);
        });

        const modules = new Map<string, Object3D>();

        gltf.scene.children.forEach((module) => {
          const moduleId = String(module.userData?.moduleId || "");
          if (!moduleId) return;
          modules.set(moduleId, module);
          const declaredOffset = module.userData?.explodeOffset;
          const direction = Array.isArray(declaredOffset)
            ? new Vector3(...declaredOffset).multiplyScalar(1.12)
            : directionForModule(moduleId);
          parts.push({
            object: module,
            base: module.position.clone().add(assemblyCorrectionForModule(moduleId)),
            direction,
            kind: partKindForModule(moduleId),
            moduleId,
          });
        });

        product.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(product);
        productSize = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        gltf.scene.position.sub(center);
        product.updateMatrixWorld(true);

        const registerGuideAnchor = (
          id: StructureGuideId,
          object: Object3D | null | undefined,
          fractions = new Vector3(0.5, 0.5, 0.5),
        ) => {
          if (!object) return;
          const objectBounds = new Box3().setFromObject(object);
          if (objectBounds.isEmpty()) return;
          const objectSize = objectBounds.getSize(new Vector3());
          const worldPoint = objectBounds.min.clone().add(new Vector3(
            objectSize.x * fractions.x,
            objectSize.y * fractions.y,
            objectSize.z * fractions.z,
          ));
          // Keep the bounds in the part's local coordinate system.  They are
          // projected on every frame, so a leader can end just outside this
          // exact part even while the exploded view is moving.
          const localBounds = new Box3();
          for (const x of PRODUCT_BOUNDARY_SIGNS) {
            for (const y of PRODUCT_BOUNDARY_SIGNS) {
              for (const z of PRODUCT_BOUNDARY_SIGNS) {
                const worldCorner = new Vector3(
                  x < 0 ? objectBounds.min.x : objectBounds.max.x,
                  y < 0 ? objectBounds.min.y : objectBounds.max.y,
                  z < 0 ? objectBounds.min.z : objectBounds.max.z,
                );
                localBounds.expandByPoint(object.worldToLocal(worldCorner));
              }
            }
          }
          guideAnchors.set(id, {
            object,
            localPoint: object.worldToLocal(worldPoint.clone()),
            localBounds,
          });
        };

        registerGuideAnchor("roof", modules.get("roof"), new Vector3(0.5, 0.55, 0.14));
        registerGuideAnchor("base", modules.get("base"));
        // Use distinct, visible zones on each real part.  Keeping every
        // anchor at its geometric centre made several leader lines converge
        // at the same height in the exploded view.
        registerGuideAnchor("columns", semanticParts.get("frame-core-xp-zp") || modules.get("frame-core"), new Vector3(0.5, 0.74, 0.5));
        registerGuideAnchor("sidePanel", semanticParts.get("service-wall-outer-skin") || modules.get("service-wall"), new Vector3(0.5, 0.61, 0.5));
        registerGuideAnchor("frontDoor", modules.get("door-leaf"), new Vector3(0.5, 0.43, 0.5));
        registerGuideAnchor("fixedGlass", modules.get("fixed-glass"), new Vector3(0.5, 0.69, 0.5));
        registerGuideAnchor("acousticPanel", semanticParts.get("rear-wall-inner-skin") || modules.get("rear-wall"), new Vector3(0.5, 0.27, 0.5));
        registerGuideAnchor("desk", deskTarget, new Vector3(0.72, 0.5, 0.32));
        registerGuideAnchor("carpet", modules.get("carpet"));
        registerGuideAnchor("lighting", lightTarget);

        setStatus("loaded");
        onReady?.("loaded");
        requestRender();
      },
      undefined,
      (error) => {
        if (!disposed) {
          console.error("SNAPOD authoritative GLB failed to load", error);
          setStatus("error");
          onReady?.("error");
        }
      },
    );

    const render = (time: number) => {
      if (disposed || !director.snapshot.visible) {
        animationFrame = 0;
        return;
      }

      // The booth only changes when scroll state, lighting or viewport size
      // changes. Cap those requested renders so an expensive GLB frame cannot
      // monopolise the main thread and make the native document scroll stutter.
      const frameInterval = 1000 / (director.snapshot.compact ? 30 : 36);
      if (lastRenderTime && time - lastRenderTime < frameInterval) {
        animationFrame = requestAnimationFrame(render);
        return;
      }
      animationFrame = 0;
      lastRenderTime = time;

      const state = director.snapshot;
      const explode = state.reducedMotion ? 0 : explosionFor(state.narrative);
      // Keep the hero product fully assembled through the hand-off to the
      // structure chapter. The previous preview offset introduced a visible
      // seam between the roof and frame before the actual exploded sequence
      // began, which made the finished product look incorrectly assembled.
      const heroPrelude = 0;
      const filmPrelude = state.reducedMotion
        ? 0
        : smoothstep(rangeProgress(state.narrative, 4.8, 5));
      const isTechnicalStructure = state.chapter === "structure";
      const isModularHandoff = !state.mobile
        && !state.reducedMotion
        && state.narrative >= 3
        && state.narrative < 3.5;
      const modularEntry = state.reducedMotion
        ? 1
        : smoothstep(rangeProgress(state.narrative, 3, 3.5));
      // Ease the camera and product into the drafting view after the raster
      // hero has started to crossfade. This prevents the 180° structure
      // orientation from reading as a hard scene cut at the chapter boundary.
      const structureEntry = isTechnicalStructure && !state.reducedMotion
        ? smoothstep(rangeProgress(state.narrative, 1, 1.18))
        : isTechnicalStructure ? 1 : 0;
      const diagonalSpread = isTechnicalStructure && !state.reducedMotion
        ? smoothstep(rangeProgress(state.narrative, 1.38, 1.58))
          * (1 - smoothstep(rangeProgress(state.narrative, 1.78, 2)))
        : 0;
      // The reference-style editorial movement is intentionally delayed until
      // the exploded assembly has completely returned to its finished form.
      // This makes the technical sequence resolve first, then carries the
      // intact booth into the following sound-story composition.
      const postExplosionHandoff = state.reducedMotion
        ? 1
        : smoothstep(rangeProgress(state.narrative, 2, 2.5));
      // A scroll-linked camera pass gives the structure chapter a deliberate
      // product-film movement: push in from the entry side, orbit upward and
      // then reveal the exploded composition. It is entirely derived from
      // scene state, so it naturally pauses off-screen and resolves to a
      // stable view for reduced motion.
      const structureTravel = isTechnicalStructure && !state.reducedMotion
        ? smoothstep(state.localProgress)
        : 0;
      const structurePush = Math.sin(structureTravel * Math.PI);
      const light = state.reducedMotion ? 1 : clamp01(state.illumination);
      const spatialLightBlend = 0;
      renderer.toneMappingExposure = lerp(0.8, 0.84, spatialLightBlend) - filmPrelude * 0.08;
      ambient.color.copy(studioLightPalette.ambient).lerp(spatialLightPalette.ambient, spatialLightBlend);
      hemisphere.color.copy(studioLightPalette.sky).lerp(spatialLightPalette.sky, spatialLightBlend);
      hemisphere.groundColor.copy(studioLightPalette.ground).lerp(spatialLightPalette.ground, spatialLightBlend);
      key.color.copy(studioLightPalette.key).lerp(spatialLightPalette.key, spatialLightBlend);
      fill.color.copy(studioLightPalette.fill).lerp(spatialLightPalette.fill, spatialLightBlend);
      rim.color.copy(studioLightPalette.rim).lerp(spatialLightPalette.rim, spatialLightBlend);
      key.intensity = (0.28 + light * 0.82) * (1 - filmPrelude * 0.12);
      fill.intensity = (0.18 + light * 0.3) * (1 - filmPrelude * 0.16);
      rim.intensity = (0.24 + light * 0.46) * (1 - filmPrelude * 0.08);
      ambient.intensity = 0.16 + light * 0.25;
      hemisphere.intensity = 0.3 + light * 0.3;
      interiorGlow.intensity = 0.08 + light * 0.54;

      if (product) {
        parts.forEach((part) => {
          const isHeroPreviewPart = part.moduleId === "roof"
            || part.moduleId === "service-wall"
            || part.moduleId === "column-covers";
          const previewOffset = isHeroPreviewPart ? heroPrelude : heroPrelude * 0.14;
          part.object.position.copy(part.base).addScaledVector(part.direction, Math.max(explode, previewOffset));
        });

        const mobile = state.mobile;
        const acousticEditorialView = !mobile && state.narrative < 3;
        // Keep the acoustic chapter as one stable editorial composition:
        // copy on the left, front-facing product on the right. Motion is
        // reserved for the sound field, avoiding copy/product crossovers.
        const acousticEndX = -0.42;
        const normalNarrativeX = sampleShift(state.narrative);
        // The modular page is a stable product-and-copy composition. Keep
        // the booth anchored on its product half for the entire chapter
        // instead of reusing the interaction chapter's lateral track.
        const modularNarrativeX = state.narrative >= 3 && state.narrative < 4
          ? -0.42
          : normalNarrativeX;
        const narrativeX = acousticEditorialView
          ? acousticEndX
          : isModularHandoff
            ? lerp(acousticEndX, modularNarrativeX, modularEntry)
            : modularNarrativeX;
        const structureX = -0.08 + diagonalSpread * 0.08;
        const exitStructureX = productSize.x * -0.08;
        const editorialX = productSize.x * narrativeX;
        const isPostExplosionHandoff = !mobile && state.narrative >= 2 && postExplosionHandoff < 1;
        product.position.x = mobile
          ? 0
          : isPostExplosionHandoff
            ? lerp(exitStructureX, editorialX, postExplosionHandoff)
            : productSize.x * lerp(narrativeX, structureX, structureEntry);
        const usesSpatialScene = false;
        // The generated room plates use a verified 2.7 m ceiling reference.
        // SPD01 is 2.3 m tall, so the editorial chapters use a smaller camera
        // fit and a lower floor contact point than the isolated product stage.
        const narrativeY = -productSize.y * (usesSpatialScene ? 0.095 : 0.012);
        const structureY = -productSize.y * 0.04;
        product.position.y = mobile
          ? productSize.y * sampleCompactY(state.narrative)
          : isPostExplosionHandoff
            ? lerp(structureY, narrativeY, postExplosionHandoff)
            : lerp(narrativeY, structureY, structureEntry);
        // One authoritative front-facing product angle for every story
        // chapter. The structure entry used to begin on the reverse side,
        // then rotate after scrolling, which made the booth feel inconsistent.
        const editorialYaw = -Math.PI * 0.5;
        product.rotation.set(
          0,
          lerp(editorialYaw, -Math.PI * 0.5, structureEntry),
          -0.62 * diagonalSpread,
        );
        interiorGlow.position.x = product.position.x - 0.18;
        interiorTarget.position.x = product.position.x - 0.08;

        const verticalDistance = productSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
        const mobileMultiplier = sampleMobileDistance(state.narrative);
        const structureFit = 1.32 + explode * 0.16 + structurePush * 0.34;
        const editorialFit = usesSpatialScene ? 1.65 : 1.46;
        const fitMultiplier = mobile
          ? mobileMultiplier
          : isPostExplosionHandoff
            ? lerp(1.32, editorialFit, postExplosionHandoff)
            : lerp(editorialFit, structureFit, structureEntry);
        const distance = verticalDistance * fitMultiplier * (1 + explode * (mobile ? 0.64 : 0.4));
        const editorialCameraX = mobile
          ? -distance * 0.3
          : lerp(-distance * 0.3, distance * (-0.46 + structureTravel * 0.9), structureEntry);
        const editorialCameraY = mobile
          ? productSize.y * 0.08
          : lerp(productSize.y * 0.08, productSize.y * (0.03 + structureTravel * 0.3), structureEntry);
        const editorialCameraZ = mobile
          ? -distance
          : lerp(-distance, -distance * (1 - structurePush * 0.1), structureEntry);
        const cameraX = isPostExplosionHandoff
          ? lerp(distance * 0.44, editorialCameraX, postExplosionHandoff)
          : editorialCameraX;
        const cameraY = isPostExplosionHandoff
          ? lerp(productSize.y * 0.33, editorialCameraY, postExplosionHandoff)
          : editorialCameraY;
        const cameraZ = editorialCameraZ;
        camera.position.set(cameraX, cameraY, cameraZ);
        // Carry the booth smoothly from the modular chapter's left product
        // half into the interaction chapter's right product half. Using the
        // continuous narrative progress avoids a camera snap at the section
        // boundary.
        const modularToInteraction = smoothstep(rangeProgress(state.narrative, 3.88, 4.5));
        const sceneFocusX = !mobile && state.narrative >= 3 && state.narrative <= 4.5
          ? productSize.x * (-1.05 + modularToInteraction * 2.1)
          : state.chapter === "interaction" && !mobile
            ? productSize.x * 1.05
            : 0;
        const structureFocusX = product.position.x + productSize.x * (structureTravel * 0.16);
        const modularFocusX = sceneFocusX;
        const editorialFocusX = acousticEditorialView
          ? productSize.x * 1.05
          : isModularHandoff
            ? lerp(productSize.x * 1.05, modularFocusX, modularEntry)
            : sceneFocusX;
        const structureExitFocusX = productSize.x * 0.08;
        const focusX = isPostExplosionHandoff
          ? lerp(structureExitFocusX, editorialFocusX, postExplosionHandoff)
          : lerp(editorialFocusX, structureFocusX, structureEntry);
        const focusY = isPostExplosionHandoff
          ? lerp(productSize.y * 0.06, -productSize.y * 0.02, postExplosionHandoff)
          : lerp(-productSize.y * 0.02, -productSize.y * (0.02 - structureTravel * 0.08), structureEntry);
        camera.lookAt(
          mobile ? product.position.x : focusX,
          focusY,
          0,
        );

        if (state.chapter === "acoustic") {
          product.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          const productMatrixWorld = product.matrixWorld;
          let left = Number.POSITIVE_INFINITY;
          let right = Number.NEGATIVE_INFINITY;
          let top = Number.POSITIVE_INFINITY;
          let bottom = Number.NEGATIVE_INFINITY;

          PRODUCT_BOUNDARY_SIGNS.forEach((xSign) => {
            PRODUCT_BOUNDARY_SIGNS.forEach((ySign) => {
              PRODUCT_BOUNDARY_SIGNS.forEach((zSign) => {
                projectedBoundaryCorner
                  .set(productSize.x * xSign, productSize.y * ySign, productSize.z * zSign)
                  .applyMatrix4(productMatrixWorld)
                  .project(camera);
                const x = (projectedBoundaryCorner.x * 0.5 + 0.5) * width;
                const y = (-projectedBoundaryCorner.y * 0.5 + 0.5) * height;
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
              });
            });
          });

          const boundary: ProductScreenBoundary = { left, right, top, bottom };
          const signature = `${left.toFixed(1)},${right.toFixed(1)},${top.toFixed(1)},${bottom.toFixed(1)}`;
          if (signature !== lastBoundarySignature) {
            lastBoundarySignature = signature;
            window.dispatchEvent(new CustomEvent<ProductScreenBoundary>(PRODUCT_BOUNDARY_EVENT, {
              detail: boundary,
            }));
          }
        }

        if (state.chapter === "structure" && guideAnchors.size) {
          product.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          const targets: StructureGuideTarget[] = [];

          guideAnchors.forEach((anchor, id) => {
            const projected = anchor.object.localToWorld(anchor.localPoint.clone()).project(camera);
            let left = Number.POSITIVE_INFINITY;
            let right = Number.NEGATIVE_INFINITY;
            let top = Number.POSITIVE_INFINITY;
            let bottom = Number.NEGATIVE_INFINITY;
            for (const x of PRODUCT_BOUNDARY_SIGNS) {
              for (const y of PRODUCT_BOUNDARY_SIGNS) {
                for (const z of PRODUCT_BOUNDARY_SIGNS) {
                  const localCorner = new Vector3(
                    x < 0 ? anchor.localBounds.min.x : anchor.localBounds.max.x,
                    y < 0 ? anchor.localBounds.min.y : anchor.localBounds.max.y,
                    z < 0 ? anchor.localBounds.min.z : anchor.localBounds.max.z,
                  );
                  const corner = anchor.object.localToWorld(localCorner).project(camera);
                  if (corner.z <= -1 || corner.z >= 1) continue;
                  const screenX = (corner.x * 0.5 + 0.5) * width;
                  const screenY = (-corner.y * 0.5 + 0.5) * height;
                  left = Math.min(left, screenX);
                  right = Math.max(right, screenX);
                  top = Math.min(top, screenY);
                  bottom = Math.max(bottom, screenY);
                }
              }
            }
            targets.push({
              id,
              x: (projected.x * 0.5 + 0.5) * width,
              y: (-projected.y * 0.5 + 0.5) * height,
              left: Number.isFinite(left) ? left : (projected.x * 0.5 + 0.5) * width,
              right: Number.isFinite(right) ? right : (projected.x * 0.5 + 0.5) * width,
              top: Number.isFinite(top) ? top : (-projected.y * 0.5 + 0.5) * height,
              bottom: Number.isFinite(bottom) ? bottom : (-projected.y * 0.5 + 0.5) * height,
              visible: projected.z > -1 && projected.z < 1,
            });
          });

          // Publish the live union of the labeled semantic parts while the
          // assembly is moving. The static product box is not sufficient for
          // the exploded view because panels travel beyond the assembled
          // silhouette; the annotation layer uses this boundary to keep every
          // text card outside the moving product.
          const visibleTargets = targets.filter((target) => target.visible);
          if (visibleTargets.length) {
            const boundary: ProductScreenBoundary = {
              left: Math.min(...visibleTargets.map((target) => target.left)),
              right: Math.max(...visibleTargets.map((target) => target.right)),
              top: Math.min(...visibleTargets.map((target) => target.top)),
              bottom: Math.max(...visibleTargets.map((target) => target.bottom)),
            };
            const boundarySignature = `${boundary.left.toFixed(1)},${boundary.right.toFixed(1)},${boundary.top.toFixed(1)},${boundary.bottom.toFixed(1)}`;
            if (boundarySignature !== lastBoundarySignature) {
              lastBoundarySignature = boundarySignature;
              window.dispatchEvent(new CustomEvent<ProductScreenBoundary>(PRODUCT_BOUNDARY_EVENT, {
                detail: boundary,
              }));
            }
          }

          const signature = targets
            .map((target) => `${target.id}:${target.x.toFixed(1)},${target.y.toFixed(1)},${target.left.toFixed(1)},${target.right.toFixed(1)}`)
            .join("|");
          if (signature !== lastGuideSignature) {
            lastGuideSignature = signature;
            window.dispatchEvent(new CustomEvent<StructureGuideTarget[]>(STRUCTURE_GUIDE_EVENT, {
              detail: targets,
            }));
          }
        }
      }

      particles.visible = !state.reducedMotion;
      particles.rotation.y = state.reducedMotion ? 0 : time * 0.000012;
      particles.position.x = product?.position.x ?? 0;
      renderer.render(scene, camera);
    };

    requestRender = () => {
      if (!disposed && director.snapshot.visible && !animationFrame) {
        animationFrame = requestAnimationFrame(render);
      }
    };

    const syncRenderState = () => {
      if (director.snapshot.visible) requestRender();
      if (!director.snapshot.visible && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };

    const unsubscribe = director.subscribe(syncRenderState);
    requestRender();

    return () => {
      disposed = true;
      unsubscribe();
      resizeObserver.disconnect();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (product) disposeObject(product);
      disposeObject(particles);
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [director, onReady]);

  return (
    <div
      className={`webgl-stage is-${status}`}
      aria-label="Tuliko SPD01 三次元製品モデル"
    >
      <div className="product-stage-reveal" data-product-reveal>
        <img
          className="webgl-reference"
          src="/assets/products/spd01-green-hero-cutout.webp"
          alt=""
          aria-hidden="true"
        />
        <div className="webgl-mount" ref={mountRef} />
        <i className="product-intro-scan" aria-hidden="true" />
      </div>
      <span className="model-status" aria-live="polite">
        {status === "loading" ? "3Dモデルを読み込んでいます" : ""}
        {status === "error" ? "製品レンダーを表示しています" : ""}
      </span>
    </div>
  );
}
