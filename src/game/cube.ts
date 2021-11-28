import { ColliderDef } from "../collider.js";
import { Component, EM, EntityManager } from "../entity-manager.js";
import { vec3 } from "../gl-matrix.js";
import { PhysicsStateDef } from "../phys_esc.js";
import { Motion, MotionDef } from "../phys_motion.js";
import {
  MotionSmoothingDef,
  ParentDef,
  RenderableDef,
  TransformDef,
} from "../renderer.js";
import { ColorDef } from "./game.js";
import {
  unshareProvokingVertices,
  getAABBFromMesh,
  Mesh,
  MeshHandle,
  MeshHandleDef,
  scaleMesh,
} from "../mesh-pool.js";
import {
  Sync,
  SyncDef,
  Authority,
  AuthorityDef,
  Me,
  MeDef,
} from "../net/components.js";
import { AABBCollider } from "../collider.js";
import { _renderer } from "../main.js";
import { Serializer, Deserializer } from "../serialize.js";
import { FinishedDef } from "../build.js";
import { CUBE_AABB, CUBE_MESH } from "./assets.js";

export const CubeConstructDef = EM.defineComponent(
  "cubeConstruct",
  (size?: number, color?: vec3) => ({
    size: size || 0,
    color: color || vec3.fromValues(0, 0, 0),
  })
);

export type CubeConstruct = Component<typeof CubeConstructDef>;

function serializeCubeConstruct(cubeConstruct: CubeConstruct, buf: Serializer) {
  buf.writeUint8(cubeConstruct.size);
  buf.writeVec3(cubeConstruct.color);
}

function deserializeCubeConstruct(
  cubeConstruct: CubeConstruct,
  buf: Deserializer
) {
  if (!buf.dummy) cubeConstruct.size = buf.readUint8();
  console.log("going to read a vector");
  buf.readVec3(cubeConstruct.color);
}

EM.registerSerializerPair(
  CubeConstructDef,
  serializeCubeConstruct,
  deserializeCubeConstruct
);

export function registerBuildCubesSystem(em: EntityManager) {
  function buildCubes(
    cubes: { id: number; cubeConstruct: CubeConstruct }[],
    { me: { pid } }: { me: Me }
  ) {
    for (let cube of cubes) {
      if (em.hasComponents(cube, [FinishedDef])) continue;

      if (!em.hasComponents(cube, [MotionDef])) {
        const motion = em.addComponent(cube.id, MotionDef);
        motion.location = [0, 0, 0];
      }
      if (!em.hasComponents(cube, [ColorDef])) {
        const color = em.addComponent(cube.id, ColorDef);
        vec3.copy(color, cube.cubeConstruct.color);
      }
      if (!em.hasComponents(cube, [MotionSmoothingDef]))
        em.addComponent(cube.id, MotionSmoothingDef);
      if (!em.hasComponents(cube, [TransformDef]))
        em.addComponent(cube.id, TransformDef);
      if (!em.hasComponents(cube, [ParentDef]))
        em.addComponent(cube.id, ParentDef);
      if (!em.hasComponents(cube, [RenderableDef])) {
        const renderable = em.addComponent(cube.id, RenderableDef);
        renderable.mesh = scaleMesh(CUBE_MESH, cube.cubeConstruct.size);
      }
      if (!em.hasComponents(cube, [PhysicsStateDef]))
        em.addComponent(cube.id, PhysicsStateDef);
      if (!em.hasComponents(cube, [ColliderDef])) {
        const collider = em.addComponent(cube.id, ColliderDef);
        collider.shape = "AABB";
        collider.solid = false;
        (collider as AABBCollider).aabb = CUBE_AABB;
      }
      if (!em.hasComponents(cube, [AuthorityDef]))
        em.addComponent(cube.id, AuthorityDef, pid, pid);
      if (!em.hasComponents(cube, [SyncDef])) {
        const sync = em.addComponent(cube.id, SyncDef);
        sync.fullComponents.push(CubeConstructDef.id);
        sync.dynamicComponents.push(MotionDef.id);
      }
      em.addComponent(cube.id, FinishedDef);
    }
  }

  em.registerSystem([CubeConstructDef], [MeDef], buildCubes);
}

export function registerMoveCubesSystem(em: EntityManager) {
  function moveCubes(
    cubes: {
      id: number;
      cubeConstruct: CubeConstruct;
      authority: Authority;
      motion: Motion;
    }[],
    { me }: { me: Me }
  ) {
    for (let cube of cubes) {
      if (cube.authority.pid == me.pid) {
        cube.motion.location[2] -= 0.01;
      }
    }
  }
  em.registerSystem(
    [CubeConstructDef, AuthorityDef, MotionDef, FinishedDef],
    [MeDef],
    moveCubes
  );
}
