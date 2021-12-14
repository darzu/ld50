import { EM, EntityManager, Component, Entity } from "../entity-manager.js";
import { mat4, quat, vec3 } from "../gl-matrix.js";
import { FinishedDef } from "../build.js";
import { ColorDef } from "./game.js";
import { RenderableDef } from "../renderer.js";
import {
  Position,
  PositionDef,
  RotationDef,
  TransformWorldDef,
} from "../transform.js";
import { AABBCollider, ColliderDef } from "../collider.js";
import {
  Authority,
  AuthorityDef,
  Me,
  MeDef,
  SyncDef,
  PredictDef,
} from "../net/components.js";
import {
  getAABBFromMesh,
  Mesh,
  MeshHandle,
  MeshHandleDef,
  scaleMesh,
  scaleMesh3,
} from "../mesh-pool.js";
import { AABB } from "../phys_broadphase.js";
import { RendererDef } from "../render_init.js";
import { Renderer } from "../render_webgpu.js";
import { Assets, AssetsDef } from "./assets.js";
import {
  AngularVelocity,
  AngularVelocityDef,
  LinearVelocity,
  LinearVelocityDef,
} from "../motion.js";
import { MotionSmoothingDef } from "../smoothing.js";

export const BulletDef = EM.defineComponent("bullet", () => {
  return true;
});
export type Bullet = Component<typeof BulletDef>;

export const BulletConstructDef = EM.defineComponent(
  "bulletConstruct",
  (loc?: vec3, vel?: vec3, angVel?: vec3) => {
    return {
      location: loc ?? vec3.fromValues(0, 0, 0),
      linearVelocity: vel ?? vec3.fromValues(0, 1, 0),
      angularVelocity: angVel ?? vec3.fromValues(0, 0, 0),
    };
  }
);
export type BulletConstruct = Component<typeof BulletConstructDef>;

EM.registerSerializerPair(
  BulletConstructDef,
  (c, writer) => {
    writer.writeVec3(c.location);
    writer.writeVec3(c.linearVelocity);
    writer.writeVec3(c.angularVelocity);
  },
  (c, reader) => {
    reader.readVec3(c.location);
    reader.readVec3(c.linearVelocity);
    reader.readVec3(c.angularVelocity);
  }
);

const BULLET_COLOR: vec3 = [0.3, 0.3, 0.8];

function createBullet(
  em: EntityManager,
  e: Entity & { bulletConstruct: BulletConstruct },
  pid: number,
  assets: Assets
) {
  if (FinishedDef.isOn(e)) return;
  const props = e.bulletConstruct;
  em.ensureComponent(e.id, PositionDef, props.location);
  em.ensureComponent(e.id, RotationDef);
  em.ensureComponent(e.id, LinearVelocityDef, props.linearVelocity);
  em.ensureComponent(e.id, AngularVelocityDef, props.angularVelocity);
  em.ensureComponent(e.id, ColorDef, BULLET_COLOR);
  em.ensureComponent(e.id, TransformWorldDef);
  em.ensureComponent(e.id, MotionSmoothingDef);
  em.ensureComponent(e.id, RenderableDef, assets.bullet.proto);
  em.ensureComponent(e.id, AuthorityDef, pid);
  em.ensureComponent(e.id, BulletDef);
  em.ensureComponent(e.id, ColliderDef, {
    shape: "AABB",
    solid: false,
    aabb: assets.bullet.aabb,
  });
  em.ensureComponent(e.id, SyncDef, [BulletConstructDef.id], [PositionDef.id]);
  em.ensureComponent(e.id, PredictDef);
  em.addComponent(e.id, FinishedDef);
}

export function registerBuildBulletsSystem(em: EntityManager) {
  em.registerSystem(
    [BulletConstructDef],
    [MeDef, AssetsDef],
    (bullets, res) => {
      for (let b of bullets) createBullet(em, b, res.me.pid, res.assets);
    },
    "buildBullets"
  );
}

export function spawnBullet(
  em: EntityManager,
  position: Position,
  linearVelocity: LinearVelocity,
  angularVelocity: AngularVelocity
) {
  const e = em.newEntity();
  em.addComponent(
    e.id,
    BulletConstructDef,
    position,
    linearVelocity,
    angularVelocity
  );
}

export function fireBullet(
  em: EntityManager,
  location: vec3,
  rotation: quat,
  speed?: number,
  rotationSpeed?: number
) {
  speed = speed || 0.02;
  rotationSpeed = rotationSpeed || 0.02;
  let bulletAxis = vec3.fromValues(0, 0, -1);
  vec3.transformQuat(bulletAxis, bulletAxis, rotation);
  const linearVelocity = vec3.scale(vec3.create(), bulletAxis, speed);
  const angularVelocity = vec3.scale(vec3.create(), bulletAxis, rotationSpeed);
  spawnBullet(em, vec3.clone(location), linearVelocity, angularVelocity);
}
