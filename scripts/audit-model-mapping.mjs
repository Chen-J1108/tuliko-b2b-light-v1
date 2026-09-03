import fs from "node:fs";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const [currentPath, candidatePath] = process.argv.slice(2);
const summaryOnly = process.argv.includes("--summary");
if (!currentPath || !candidatePath) {
  throw new Error("Usage: node scripts/audit-model-mapping.mjs <current.glb> <candidate.glb>");
}

async function load(filePath) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const bytes = fs.readFileSync(filePath);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  const min = bounds.min.clone();
  const size = bounds.getSize(new Vector3());
  const meshes = [];
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const box = new Box3().setFromObject(node);
    const center = box.getCenter(new Vector3()).sub(min).divide(size);
    const meshSize = box.getSize(new Vector3()).divide(size);
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    meshes.push({
      name: node.name,
      moduleId: node.userData?.moduleId || "",
      partId: node.userData?.partId || "",
      center: center.toArray().map((value) => Number(value.toFixed(5))),
      size: meshSize.toArray().map((value) => Number(value.toFixed(5))),
      rawCenter: box.getCenter(new Vector3()).toArray().map((value) => Number(value.toFixed(4))),
      rawSize: box.getSize(new Vector3()).toArray().map((value) => Number(value.toFixed(4))),
      triangles: node.geometry.index ? node.geometry.index.count / 3 : node.geometry.attributes.position.count / 3,
      material: material?.name || "",
      color: material?.color?.getHexString?.() || "",
    });
  });
  return {
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: size.toArray(),
    },
    meshes,
  };
}

const current = await load(currentPath);
const candidate = await load(candidatePath);

const transforms = {
  identity: ([x, y, z], [sx, sy, sz]) => [[x, y, z], [sx, sy, sz]],
  rotate90: ([x, y, z], [sx, sy, sz]) => [[1 - z, y, x], [sz, sy, sx]],
  rotate180: ([x, y, z], [sx, sy, sz]) => [[1 - x, y, 1 - z], [sx, sy, sz]],
  rotate270: ([x, y, z], [sx, sy, sz]) => [[z, y, 1 - x], [sz, sy, sx]],
  mirrorX: ([x, y, z], [sx, sy, sz]) => [[1 - x, y, z], [sx, sy, sz]],
  mirrorXRotate90: ([x, y, z], [sx, sy, sz]) => [[1 - z, y, 1 - x], [sz, sy, sx]],
  mirrorXRotate180: ([x, y, z], [sx, sy, sz]) => [[x, y, 1 - z], [sx, sy, sz]],
  mirrorXRotate270: ([x, y, z], [sx, sy, sz]) => [[z, y, x], [sz, sy, sx]],
};

const distance = (candidateMesh, currentMesh, transform) => {
  const [center, size] = transform(candidateMesh.center, candidateMesh.size);
  const centerDistance = center.reduce((sum, value, axis) => sum + (value - currentMesh.center[axis]) ** 2, 0);
  const sizeDistance = size.reduce((sum, value, axis) => sum + (value - currentMesh.size[axis]) ** 2, 0);
  const triangleDistance = Math.abs(Math.log1p(candidateMesh.triangles) - Math.log1p(currentMesh.triangles));
  return centerDistance * 10 + sizeDistance * 4 + triangleDistance * 0.025;
};

const mappingSummaries = Object.entries(transforms).map(([name, transform]) => {
  const matches = candidate.meshes.map((candidateMesh) => {
    const ranked = current.meshes
      .map((currentMesh) => ({ currentMesh, score: distance(candidateMesh, currentMesh, transform) }))
      .sort((a, b) => a.score - b.score);
    return { candidateMesh, ...ranked[0], secondScore: ranked[1]?.score ?? Infinity };
  });
  const scores = matches.map(({ score }) => score).sort((a, b) => a - b);
  return {
    name,
    mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    median: scores[Math.floor(scores.length / 2)],
    p90: scores[Math.floor(scores.length * 0.9)],
    matches,
  };
}).sort((a, b) => a.mean - b.mean);

const best = mappingSummaries[0];
const moduleCounts = {};
const moduleTriangleCounts = {};
const materialNamesByModule = {};
for (const match of best.matches) {
  const key = match.currentMesh.moduleId || "unmapped";
  moduleCounts[key] = (moduleCounts[key] || 0) + 1;
  moduleTriangleCounts[key] = (moduleTriangleCounts[key] || 0) + match.candidateMesh.triangles;
  materialNamesByModule[key] ||= {};
  const materialName = match.candidateMesh.material || "unnamed";
  materialNamesByModule[key][materialName] = (materialNamesByModule[key][materialName] || 0) + 1;
}

const largestCandidateMatches = [...best.matches]
  .sort((a, b) => b.candidateMesh.size.reduce((p, value) => p * Math.max(value, 0.0001), 1)
    - a.candidateMesh.size.reduce((p, value) => p * Math.max(value, 0.0001), 1))
  .slice(0, 30)
  .map((match) => ({
    candidate: match.candidateMesh.name,
    candidateCenter: match.candidateMesh.center,
    candidateSize: match.candidateMesh.size,
    candidateTriangles: match.candidateMesh.triangles,
    matchModule: match.currentMesh.moduleId,
    matchPart: match.currentMesh.partId,
    matchName: match.currentMesh.name,
    score: Number(match.score.toFixed(5)),
    margin: Number((match.secondScore - match.score).toFixed(5)),
  }));

console.log(JSON.stringify({
  current: {
    bounds: current.bounds,
    meshCount: current.meshes.length,
  },
  candidate: {
    bounds: candidate.bounds,
    meshCount: candidate.meshes.length,
  },
  transforms: mappingSummaries.map(({ name, mean, median, p90 }) => ({
    name,
    mean: Number(mean.toFixed(5)),
    median: Number(median.toFixed(5)),
    p90: Number(p90.toFixed(5)),
  })),
  bestTransform: best.name,
  moduleCounts,
  moduleTriangleCounts,
  materialNamesByModule,
  ...(summaryOnly ? {} : { largestCandidateMatches }),
}, null, 2));
