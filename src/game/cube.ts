import { ColliderDef } from "../physics/collider.js";
import { Component, EM, EntityManager } from "../entity-manager.js";
import { vec3 } from "../gl-matrix.js";
import { RenderableConstructDef } from "../render/renderer.js";
import {
  PhysicsParentDef,
  Position,
  PositionDef,
} from "../physics/transform.js";
import { ColorDef } from "./game.js";
import { getAABBFromMesh, scaleMesh } from "../render/mesh-pool.js";
import {
  SyncDef,
  Authority,
  AuthorityDef,
  Me,
  MeDef,
} from "../net/components.js";
import { AABBCollider } from "../physics/collider.js";
import { Serializer, Deserializer } from "../serialize.js";
import { FinishedDef } from "../build.js";
import { Assets, AssetsDef } from "./assets.js";
import { MotionSmoothingDef } from "../smoothing.js";

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
    { me: { pid }, assets }: { me: Me; assets: Assets }
  ) {
    for (let cube of cubes) {
      if (em.hasComponents(cube, [FinishedDef])) continue;

      if (!em.hasComponents(cube, [PositionDef]))
        em.addComponent(cube.id, PositionDef);
      if (!em.hasComponents(cube, [ColorDef])) {
        const color = em.addComponent(cube.id, ColorDef);
        vec3.copy(color, cube.cubeConstruct.color);
      }
      if (!em.hasComponents(cube, [MotionSmoothingDef]))
        em.addComponent(cube.id, MotionSmoothingDef);
      if (!em.hasComponents(cube, [PhysicsParentDef]))
        em.addComponent(cube.id, PhysicsParentDef);
      const mesh = scaleMesh(assets.cube.mesh, cube.cubeConstruct.size);
      if (!em.hasComponents(cube, [RenderableConstructDef])) {
        const renderable = em.addComponent(
          cube.id,
          RenderableConstructDef,
          mesh
        );
      }
      if (!em.hasComponents(cube, [ColliderDef])) {
        const collider = em.addComponent(cube.id, ColliderDef);
        collider.shape = "AABB";
        collider.solid = false;
        (collider as AABBCollider).aabb = getAABBFromMesh(mesh);
      }
      if (!em.hasComponents(cube, [AuthorityDef]))
        em.addComponent(cube.id, AuthorityDef, pid);
      if (!em.hasComponents(cube, [SyncDef])) {
        const sync = em.addComponent(cube.id, SyncDef);
        sync.fullComponents.push(CubeConstructDef.id);
        sync.dynamicComponents.push(PositionDef.id);
      }
      em.addComponent(cube.id, FinishedDef);
    }
  }

  em.registerSystem([CubeConstructDef], [MeDef, AssetsDef], buildCubes);
}

export function registerMoveCubesSystem(em: EntityManager) {
  function moveCubes(
    cubes: {
      id: number;
      cubeConstruct: CubeConstruct;
      authority: Authority;
      position: Position;
    }[],
    { me }: { me: Me }
  ) {
    for (let cube of cubes) {
      if (cube.authority.pid == me.pid) {
        cube.position[2] -= 0.01;
      }
    }
  }
  em.registerSystem(
    [CubeConstructDef, AuthorityDef, PositionDef, FinishedDef],
    [MeDef],
    moveCubes
  );
}
