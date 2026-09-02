import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import occtFactory from "occt-import-js";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Scene,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || process.env.SNAPOD_STEP_SOURCE;
const outputPath = path.resolve(
  process.argv[3] || path.join(projectRoot, "public", "assets", "models", "snapod-small.glb"),
);
const reportPath = path.join(projectRoot, "analysis", "snapod-small-model-report.json");

if (!sourcePath) {
  throw new Error(
    "Missing STEP source. Run: npm run model:convert -- <source.stp> [output.glb]",
  );
}

if (!fs.existsSync(sourcePath)) {
  throw new Error(`STEP source not found: ${sourcePath}`);
}

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader ??= NodeFileReader;

const colorKey = (color) => color.map((value) => value.toFixed(4)).join(",");
const materials = new Map();

const materialPresets = {
  frame: {
    color: [0.07, 0.076, 0.08],
    roughness: 0.32,
    metalness: 0.3,
  },
  sage: {
    color: [0.34, 0.44, 0.37],
    roughness: 0.5,
    metalness: 0.03,
  },
  felt: {
    color: [0.33, 0.34, 0.34],
    roughness: 0.94,
    metalness: 0,
  },
  desk: {
    color: [0.84, 0.84, 0.82],
    roughness: 0.34,
    metalness: 0.02,
  },
  floor: {
    color: [0.13, 0.14, 0.15],
    roughness: 0.9,
    metalness: 0.01,
  },
  ceiling: {
    color: [0.28, 0.29, 0.29],
    roughness: 0.84,
    metalness: 0,
  },
  glass: {
    color: [0.62, 0.69, 0.7],
    roughness: 0.08,
    metalness: 0.04,
  },
};

function createMaterial(color, kind = "solid") {
  const key = `${kind}:${colorKey(color)}`;
  if (materials.has(key)) return materials.get(key);

  const displayColor = new Color().setRGB(color[0], color[1], color[2], SRGBColorSpace);
  const preset = materialPresets[kind] || materialPresets.frame;
  const materialOptions = {
    name: key,
    color: displayColor,
    roughness: preset.roughness,
    metalness: preset.metalness,
    transparent: kind === "glass",
    // The assembly contains three coplanar glass layers on both the front and
    // rear. A low per-layer alpha keeps the six layers optically transparent.
    opacity: kind === "glass" ? 0.048 : 1,
    depthWrite: kind !== "glass",
  };
  if (kind === "glass") materialOptions.side = DoubleSide;
  const material = kind === "glass"
    ? new MeshPhysicalMaterial({
        ...materialOptions,
        clearcoat: 0.72,
        clearcoatRoughness: 0.12,
        ior: 1.45,
        thickness: 5,
      })
    : new MeshStandardMaterial(materialOptions);

  materials.set(key, material);
  return material;
}

function meshBounds(meshData) {
  const positions = meshData.attributes.position.array;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }

  return {
    min,
    max,
    size: max.map((value, axis) => value - min[axis]),
    center: max.map((value, axis) => (value + min[axis]) / 2),
  };
}

function isGlassPanel(bounds) {
  const [width, depth, height] = bounds.size;
  return width > 800 && depth <= 12 && height > 2000 && Math.abs(bounds.center[1]) > 400;
}

function isOuterSidePanel(bounds) {
  const [width, depth, height] = bounds.size;
  return width <= 12 && depth > 700 && height > 2000 && Math.abs(bounds.center[0]) > 450;
}

function isDeskTop(bounds) {
  const [width, depth, height] = bounds.size;
  return width > 520 && width < 700
    && depth > 220 && depth < 380
    && height < 45
    && bounds.center[2] < -800
    && bounds.center[2] > -1450;
}

function isHorizontalPanel(bounds) {
  const [width, depth, height] = bounds.size;
  return width > 700 && depth > 700 && height < 85;
}

function materialProfile(bounds) {
  if (isGlassPanel(bounds)) return { ...materialPresets.glass, kind: "glass" };
  if (isOuterSidePanel(bounds)) return { ...materialPresets.sage, kind: "side-panel" };
  if (isDeskTop(bounds)) return { ...materialPresets.desk, kind: "desk" };
  if (isHorizontalPanel(bounds) && bounds.center[2] > -140) {
    return { ...materialPresets.floor, kind: "floor" };
  }
  if (isHorizontalPanel(bounds) && bounds.center[2] < -2070) {
    return { ...materialPresets.ceiling, kind: "ceiling" };
  }
  return { ...materialPresets.frame, kind: "frame" };
}

function faceNormal(face, sourceIndices, normals) {
  if (!normals) return null;
  const sum = [0, 0, 0];
  let count = 0;
  for (let triangle = face.first; triangle <= face.last; triangle += 1) {
    const offset = triangle * 3;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const normalOffset = sourceIndices[offset + vertex] * 3;
      sum[0] += normals[normalOffset];
      sum[1] += normals[normalOffset + 1];
      sum[2] += normals[normalOffset + 2];
      count += 1;
    }
  }
  if (!count) return null;
  const length = Math.hypot(...sum) || 1;
  return sum.map((value) => value / length);
}

function faceMaterial(profile, bounds, face, sourceIndices, normals) {
  if (profile.kind !== "side-panel") return profile;
  const normal = faceNormal(face, sourceIndices, normals);
  if (!normal) return { ...materialPresets.sage, kind: "sage" };
  const exteriorDirection = Math.sign(bounds.center[0]) || 1;
  return normal[0] * exteriorDirection < -0.35
    ? { ...materialPresets.felt, kind: "felt" }
    : { ...materialPresets.sage, kind: "sage" };
}

function buildMesh(meshData, meshIndex) {
  const bounds = meshBounds(meshData);
  const geometry = new BufferGeometry();
  const positions = Float32Array.from(meshData.attributes.position.array);
  const normals = meshData.attributes.normal?.array
    ? Float32Array.from(meshData.attributes.normal.array)
    : null;
  const sourceIndices = meshData.index.array.flat?.() || meshData.index.array;
  const profile = materialProfile(bounds);

  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute("normal", new BufferAttribute(normals, 3));

  const faceBuckets = new Map();
  const glass = profile.kind === "glass";

  for (const face of meshData.brep_faces) {
    const resolved = faceMaterial(profile, bounds, face, sourceIndices, normals);
    const key = `${resolved.kind}:${colorKey(resolved.color)}`;
    if (!faceBuckets.has(key)) faceBuckets.set(key, { ...resolved, indices: [] });

    const bucket = faceBuckets.get(key).indices;
    for (let triangle = face.first; triangle <= face.last; triangle += 1) {
      const offset = triangle * 3;
      bucket.push(sourceIndices[offset], sourceIndices[offset + 1], sourceIndices[offset + 2]);
    }
  }

  if (faceBuckets.size === 0) {
    const resolved = profile.kind === "side-panel"
      ? { ...materialPresets.sage, kind: "sage" }
      : profile;
    faceBuckets.set(`${resolved.kind}:${colorKey(resolved.color)}`, {
      ...resolved,
      indices: Array.from(sourceIndices),
    });
  }

  const orderedIndices = [];
  const meshMaterials = [];
  for (const bucket of faceBuckets.values()) {
    const start = orderedIndices.length;
    orderedIndices.push(...bucket.indices);
    geometry.addGroup(start, bucket.indices.length, meshMaterials.length);
    meshMaterials.push(createMaterial(bucket.color, bucket.kind));
  }

  geometry.setIndex(orderedIndices);
  geometry.computeBoundingSphere();

  const mesh = new Mesh(geometry, meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials);
  mesh.name = `${meshData.name || "snapod-part"}-${String(meshIndex).padStart(3, "0")}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    bounds,
    glass,
    sidePanel: isOuterSidePanel(bounds),
    materialKinds: [...faceBuckets.values()].map((bucket) => bucket.kind),
  };
}

const startedAt = Date.now();
const sourceBytes = fs.readFileSync(sourcePath);
const occt = await occtFactory();
const result = occt.ReadStepFile(sourceBytes, {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.002,
  angularDeflection: 0.5,
});

if (!result.success) throw new Error("OpenCascade could not import the STEP assembly.");

const scene = new Scene();
scene.name = "SNAPOD SPD01 hero model";
const sourceGroup = new Group();
sourceGroup.name = "SNAPOD small booth assembly";
scene.add(sourceGroup);

let triangleCount = 0;
let vertexCount = 0;
let glassMeshCount = 0;
let sidePanelCount = 0;
const materialKindCounts = {};

result.meshes.forEach((meshData, meshIndex) => {
  const built = buildMesh(meshData, meshIndex);
  sourceGroup.add(built.mesh);
  triangleCount += meshData.index.array.length / 3;
  vertexCount += meshData.attributes.position.array.length / 3;
  glassMeshCount += Number(built.glass);
  sidePanelCount += Number(built.sidePanel);
  built.materialKinds.forEach((kind) => {
    materialKindCounts[kind] = (materialKindCounts[kind] || 0) + 1;
  });
});

const sourceBounds = new Box3().setFromObject(sourceGroup);
const sourceCenter = sourceBounds.getCenter(new Vector3());
sourceGroup.position.copy(sourceCenter).multiplyScalar(-1);

const uprightGroup = new Group();
uprightGroup.name = "Z-up to Y-up correction";
uprightGroup.rotation.x = Math.PI / 2;
uprightGroup.add(sourceGroup);
scene.clear();
scene.add(uprightGroup);
scene.updateMatrixWorld(true);

const normalizedBounds = new Box3().setFromObject(scene);
const normalizedSize = normalizedBounds.getSize(new Vector3());

const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  trs: false,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(glb));

const report = {
  source: path.resolve(sourcePath),
  output: outputPath,
  sourceBytes: sourceBytes.byteLength,
  outputBytes: fs.statSync(outputPath).size,
  meshCount: result.meshes.length,
  vertexCount,
  triangleCount,
  glassMeshCount,
  sidePanelCount,
  outputSizeMillimeters: normalizedSize.toArray(),
  materialCount: materials.size,
  materialKindCounts,
  tessellation: {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.002,
    angularDeflection: 0.5,
  },
  durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
