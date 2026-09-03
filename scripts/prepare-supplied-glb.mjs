import fs from "node:fs";
import path from "node:path";
import { Box3, Group, Matrix4, Scene, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const [referencePath, sourcePath, outputPath] = process.argv.slice(2);
if (!referencePath || !sourcePath || !outputPath) {
  throw new Error("Usage: node scripts/prepare-supplied-glb.mjs <semantic-reference.glb> <supplied.glb> <output.glb>");
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

async function load(filePath) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const bytes = fs.readFileSync(filePath);
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  const min = bounds.min.clone();
  const size = bounds.getSize(new Vector3());
  const meshes = [];
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const box = new Box3().setFromObject(node);
    meshes.push({
      node,
      center: box.getCenter(new Vector3()).sub(min).divide(size),
      size: box.getSize(new Vector3()).divide(size),
      triangles: node.geometry.index
        ? node.geometry.index.count / 3
        : node.geometry.attributes.position.count / 3,
    });
  });
  return { gltf, bounds, meshes };
}

function rotateCandidateBounds(mesh) {
  return {
    center: new Vector3(1 - mesh.center.z, mesh.center.y, mesh.center.x),
    size: new Vector3(mesh.size.z, mesh.size.y, mesh.size.x),
  };
}

function matchDistance(candidate, reference) {
  const transformed = rotateCandidateBounds(candidate);
  const centerDistance = transformed.center.distanceToSquared(reference.center);
  const sizeDistance = transformed.size.distanceToSquared(reference.size);
  const triangleDistance = Math.abs(
    Math.log1p(candidate.triangles) - Math.log1p(reference.triangles),
  );
  return centerDistance * 10 + sizeDistance * 4 + triangleDistance * 0.025;
}

function assignReferenceMaterials(target, reference) {
  const targetMaterials = Array.isArray(target.material) ? target.material : [target.material];
  const referenceMaterials = Array.isArray(reference.material)
    ? reference.material
    : [reference.material];
  targetMaterials.forEach((material, index) => {
    targetMaterials[index] = (referenceMaterials[index] || referenceMaterials[0] || material).clone();
  });
  target.material = Array.isArray(target.material) ? targetMaterials : targetMaterials[0];
}

const reference = await load(referencePath);
const candidate = await load(sourcePath);
const modules = new Map();
const moduleMetadata = new Map(
  reference.gltf.scene.children
    .filter((node) => node.userData?.moduleId)
    .map((node) => [node.userData.moduleId, structuredClone(node.userData)]),
);

for (const [moduleId, metadata] of moduleMetadata) {
  const group = new Group();
  group.name = `SNAPOD module ${moduleId}`;
  group.userData = metadata;
  modules.set(moduleId, group);
}

const sourceCenter = candidate.bounds.getCenter(new Vector3());
const align = new Matrix4()
  .makeRotationY(-Math.PI / 2)
  .multiply(new Matrix4().makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z));

const scores = [];
for (const candidateMesh of candidate.meshes) {
  const ranked = reference.meshes
    .map((referenceMesh) => ({
      referenceMesh,
      score: matchDistance(candidateMesh, referenceMesh),
    }))
    .sort((a, b) => a.score - b.score);
  const match = ranked[0];
  const moduleId = String(match.referenceMesh.node.userData?.moduleId || "base");
  const mesh = candidateMesh.node.clone(false);
  mesh.name = `supplied-${moduleId}-${String(scores.length + 1).padStart(3, "0")}`;
  mesh.userData = {
    ...structuredClone(candidateMesh.node.userData),
    moduleId,
    partId: String(match.referenceMesh.node.userData?.partId || `${moduleId}-detail`),
    semanticMatchScore: Number(match.score.toFixed(6)),
  };
  mesh.geometry = candidateMesh.node.geometry.clone();
  mesh.geometry.applyMatrix4(align.clone().multiply(candidateMesh.node.matrixWorld));
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  assignReferenceMaterials(mesh, match.referenceMesh.node);
  modules.get(moduleId)?.add(mesh);
  scores.push(match.score);
}

const scene = new Scene();
scene.name = "SNAPOD small white booth — supplied semantic web model";
for (const group of modules.values()) scene.add(group);
scene.updateMatrixWorld(true);

const exporter = new GLTFExporter();
const binary = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  trs: false,
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(binary));

scores.sort((a, b) => a - b);
const outputBounds = new Box3().setFromObject(scene);
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  outputBytes: fs.statSync(outputPath).size,
  meshCount: candidate.meshes.length,
  moduleCounts: Object.fromEntries(
    [...modules].map(([moduleId, group]) => [moduleId, group.children.length]),
  ),
  matchScore: {
    median: Number(scores[Math.floor(scores.length / 2)].toFixed(6)),
    p90: Number(scores[Math.floor(scores.length * 0.9)].toFixed(6)),
    max: Number(scores.at(-1).toFixed(6)),
  },
  outputSizeMeters: outputBounds.getSize(new Vector3()).toArray(),
}, null, 2));
