// player controller component and system

import { quat, vec3 } from "../gl-matrix.js";
import { Inputs, InputsDef } from "../inputs.js";
import { InWorld, InWorldDef } from "../state.js";
import { createMotionProps, Motion, MotionDef } from "../phys_motion.js";
import { Component, EM, Entity, EntityManager } from "../entity-manager.js";
import { Time, TimeDef } from "../time.js";
import { ColorDef } from "./game.js";
import { spawnBullet } from "./bullet.js";
import { FinishedDef } from "../build.js";
import {
  MotionSmoothingDef,
  RenderableDef,
  TransformDef,
} from "../renderer.js";
import { PhysicsStateDef } from "../phys_esc.js";
import {
  Authority,
  AuthorityDef,
  Me,
  MeDef,
  SyncDef,
} from "../net/components.js";
import { AABBCollider, ColliderDef } from "../collider.js";
import { HatDef } from "./hat.js";
import { CUBE_AABB, CUBE_MESH } from "./assets.js";

export const PlayerEntDef = EM.defineComponent("player", (gravity?: number) => {
  return {
    jumpSpeed: 0.003,
    gravity: gravity ?? 0.1,
    // hat stuff
    // TODO(@darzu): better abstraction
    hat: 0,
    interactingWith: 0,
    dropping: false,
  };
});
export type PlayerEnt = Component<typeof PlayerEntDef>;

export const PlayerConstructDef = EM.defineComponent(
  "playerConstruct",
  (loc?: vec3) => {
    return {
      location: loc ?? vec3.create(),
    };
  }
);
export type PlayerConstruct = Component<typeof PlayerConstructDef>;

EM.registerSerializerPair(
  PlayerConstructDef,
  (c, writer) => {
    writer.writeVec3(c.location);
  },
  (c, reader) => {
    reader.readVec3(c.location);
  }
);

interface PlayerObj {
  id: number;
  player: PlayerEnt;
  motion: Motion;
  authority: Authority;
}

export const CameraDef = EM.defineComponent("camera", () => {
  return {
    rotation: quat.create(),
    location: vec3.create(),
  };
});
export type CameraProps = Component<typeof CameraDef>;

export function registerStepPlayers(em: EntityManager) {
  em.registerSystem(
    [PlayerEntDef, MotionDef, AuthorityDef],
    [TimeDef, CameraDef, InputsDef, MeDef],
    stepPlayers
  );
}

const INTERACTION_DISTANCE = 5;
const INTERACTION_ANGLE = Math.PI / 6;
// TODO: this function is very bad. It should probably use an oct-tree or something.
function getInteractionObject(
  playerMotion: Motion,
  hats: { id: number; motion: Motion; inWorld: InWorld }[]
): number {
  let bestDistance = INTERACTION_DISTANCE;
  let bestObj = 0;

  for (let hat of hats) {
    if (hat.inWorld.is) {
      let to = vec3.sub(
        vec3.create(),
        hat.motion.location,
        playerMotion.location
      );
      let distance = vec3.len(to);
      if (distance < bestDistance) {
        let direction = vec3.normalize(to, to);
        let playerDirection = vec3.fromValues(0, 0, -1);
        vec3.transformQuat(
          playerDirection,
          playerDirection,
          playerMotion.rotation
        );
        if (
          Math.abs(vec3.angle(direction, playerDirection)) < INTERACTION_ANGLE
        ) {
          bestDistance = distance;
          bestObj = hat.id;
        }
      }
    }
  }
  return bestObj;
}

function stepPlayers(
  players: PlayerObj[],
  resources: { time: Time; camera: CameraProps; inputs: Inputs; me: Me }
) {
  const {
    time: { dt },
    inputs,
    camera,
  } = resources;

  const hats = EM.filterEntities([HatDef, MotionDef, InWorldDef]);

  //console.log(`${players.length} players, ${hats.length} hats`);

  for (let p of players) {
    if (p.authority.pid !== resources.me.pid) continue;
    // fall with gravity
    // TODO(@darzu): what r the units of gravity here?
    p.motion.linearVelocity[1] -= (p.player.gravity / 1000) * dt;

    // move player
    let vel = vec3.fromValues(0, 0, 0);
    let playerSpeed = 0.001;
    let n = playerSpeed * dt;
    if (inputs.keyDowns["a"]) {
      vec3.add(vel, vel, vec3.fromValues(-n, 0, 0));
    }
    if (inputs.keyDowns["d"]) {
      vec3.add(vel, vel, vec3.fromValues(n, 0, 0));
    }
    if (inputs.keyDowns["w"]) {
      vec3.add(vel, vel, vec3.fromValues(0, 0, -n));
    }
    if (inputs.keyDowns["s"]) {
      vec3.add(vel, vel, vec3.fromValues(0, 0, n));
    }

    // TODO(@darzu): rework to use phsyiscs colliders
    if (inputs.keyClicks["e"]) {
      const interactionObject = getInteractionObject(p.motion, hats);
      if (interactionObject)
        console.log(`interactionObject: ${interactionObject}`);
      p.player.interactingWith = interactionObject;
    } else {
      p.player.interactingWith = 0;
    }
    p.player.dropping = (inputs.keyClicks["q"] || 0) > 0;
    // if (inputs.keyDowns["shift"]) {
    //   vec3.add(vel, vel, vec3.fromValues(0, n, 0));
    // }
    // if (inputs.keyDowns["c"]) {
    //   vec3.add(vel, vel, vec3.fromValues(0, -n, 0));
    // }
    if (inputs.keyClicks[" "]) {
      p.motion.linearVelocity[1] = p.player.jumpSpeed * dt;
    }

    vec3.transformQuat(vel, vel, p.motion.rotation);

    // vec3.add(player.motion.linearVelocity, player.motion.linearVelocity, vel);

    // x and z from local movement
    p.motion.linearVelocity[0] = vel[0];
    p.motion.linearVelocity[2] = vel[2];

    quat.rotateY(p.motion.rotation, p.motion.rotation, -inputs.mouseX * 0.001);
    quat.rotateX(camera.rotation, camera.rotation, -inputs.mouseY * 0.001);

    // add bullet on lclick
    if (inputs.lclick) {
      let bullet_axis = vec3.fromValues(0, 0, -1);
      bullet_axis = vec3.transformQuat(
        bullet_axis,
        bullet_axis,
        p.motion.rotation
      );
      let bulletMotion = createMotionProps({});
      bulletMotion.location = vec3.clone(p.motion.location);
      bulletMotion.rotation = quat.clone(p.motion.rotation);
      bulletMotion.linearVelocity = vec3.scale(
        bulletMotion.linearVelocity,
        bullet_axis,
        0.02
      );
      // TODO(@darzu): adds player motion
      // bulletMotion.linearVelocity = vec3.add(
      //   bulletMotion.linearVelocity,
      //   bulletMotion.linearVelocity,
      //   player.motion.linearVelocity
      // );
      bulletMotion.angularVelocity = vec3.scale(
        bulletMotion.angularVelocity,
        bullet_axis,
        0.01
      );
      spawnBullet(EM, bulletMotion);
    }
    if (inputs.rclick) {
      const SPREAD = 5;
      const GAP = 1.0;
      for (let xi = 0; xi <= SPREAD; xi++) {
        for (let yi = 0; yi <= SPREAD; yi++) {
          const x = (xi - SPREAD / 2) * GAP;
          const y = (yi - SPREAD / 2) * GAP;
          let bullet_axis = vec3.fromValues(0, 0, -1);
          bullet_axis = vec3.transformQuat(
            bullet_axis,
            bullet_axis,
            p.motion.rotation
          );
          let bulletMotion = createMotionProps({});
          bulletMotion.location = vec3.add(
            vec3.create(),
            p.motion.location,
            vec3.fromValues(x, y, 0)
          );
          bulletMotion.rotation = quat.clone(p.motion.rotation);
          bulletMotion.linearVelocity = vec3.scale(
            bulletMotion.linearVelocity,
            bullet_axis,
            0.005
          );
          bulletMotion.linearVelocity = vec3.add(
            bulletMotion.linearVelocity,
            bulletMotion.linearVelocity,
            p.motion.linearVelocity
          );
          bulletMotion.angularVelocity = vec3.scale(
            bulletMotion.angularVelocity,
            bullet_axis,
            0.01
          );
          spawnBullet(EM, bulletMotion);
        }
      }
    }
  }
}

function createPlayer(
  em: EntityManager,
  e: Entity & { playerConstruct: PlayerConstruct },
  pid: number
) {
  if (FinishedDef.isOn(e)) return;
  const props = e.playerConstruct;
  if (!MotionDef.isOn(e)) em.addComponent(e.id, MotionDef, props.location);
  if (!ColorDef.isOn(e)) em.addComponent(e.id, ColorDef, [0, 0.2, 0]);
  if (!TransformDef.isOn(e)) em.addComponent(e.id, TransformDef);
  if (!MotionSmoothingDef.isOn(e)) em.addComponent(e.id, MotionSmoothingDef);
  if (!RenderableDef.isOn(e)) em.addComponent(e.id, RenderableDef, CUBE_MESH);
  if (!PhysicsStateDef.isOn(e)) em.addComponent(e.id, PhysicsStateDef);
  if (!AuthorityDef.isOn(e)) em.addComponent(e.id, AuthorityDef, pid, pid);
  if (!PlayerEntDef.isOn(e)) em.addComponent(e.id, PlayerEntDef);
  if (!InWorldDef.isOn(e)) em.addComponent(e.id, InWorldDef, true);
  if (!ColliderDef.isOn(e)) {
    const collider = em.addComponent(e.id, ColliderDef);
    collider.shape = "AABB";
    collider.solid = true;
    (collider as AABBCollider).aabb = CUBE_AABB;
  }
  if (!SyncDef.isOn(e)) {
    const sync = em.addComponent(e.id, SyncDef);
    sync.fullComponents.push(PlayerConstructDef.id);
    sync.dynamicComponents.push(MotionDef.id);
  }
  em.addComponent(e.id, FinishedDef);
}

export function registerBuildPlayersSystem(em: EntityManager) {
  em.registerSystem([PlayerConstructDef], [MeDef], (players, res) => {
    for (let p of players) createPlayer(em, p, res.me.pid);
  });
}