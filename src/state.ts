import { mat4, vec3, quat } from "./gl-matrix.js";
import { Serializer, Deserializer } from "./serialize.js";
import { Mesh, MeshHandle } from "./mesh-pool.js";
import { Renderer } from "./render_webgpu.js";
import { AABB, checkCollisions, copyAABB } from "./phys_broadphase.js";
import {
  copyMotionProps,
  createMotionProps,
  MotionProps,
} from "./phys_motion.js";
import { CollidesWith, ReboundData, IdPair, stepPhysics } from "./phys.js";
import { Inputs } from "./inputs.js";

const SMOOTH = true;
const ERROR_SMOOTHING_FACTOR = 0.9 ** (60 / 1000);
const EPSILON = 0.0001;

export function scaleMesh(m: Mesh, by: number): Mesh {
  let pos = m.pos.map((p) => vec3.scale(vec3.create(), p, by));
  return { ...m, pos };
}
export function scaleMesh3(m: Mesh, by: vec3): Mesh {
  let pos = m.pos.map((p) => vec3.multiply(vec3.create(), p, by));
  return { ...m, pos };
}

const working_quat = quat.create();
const identity_quat = quat.create();
const working_vec3 = vec3.create();

/* TODO: add "versioning" of objects. 
Right now we have two types of state updates: full and dynamic. 
A full update is only guaranteed to happen once, on object creation; 
we track which nodes have seen each object and try to only sync each 
object fully once. We could instead track which nodes have seen which 
*version* of each object; we could then trigger a full sync again by 
bumping a version number. We could use this for properties that change 
infrequently.

For objects with so much state that doing a full sync even infrequently is
cost-prohibitive (player objects?), could also imagine a change log. Can use
versions for this, too--a log entry is associated with a version and we sync
nodes all log entries we think they might not have seen.

For both of these, should use typescript's getters and setters to make sure
everything gets updated in the right place.
 */
export abstract class GameObject {
  id: number;
  creator: number;

  authority: number;
  authority_seq: number;
  snap_seq: number;
  location_error: vec3;
  rotation_error: quat;
  deleted: boolean = false;

  // physics
  motion: MotionProps;
  lastMotion?: MotionProps;
  localAABB: AABB;
  worldAABB: AABB;
  motionAABB: AABB;

  // derivative state:
  // NOTE: it kinda sucks to have duplicate sources of truth on loc & rot,
  // but it's more important that we don't unnecessarily recompute this transform
  transform: mat4;

  constructor(id: number, creator: number) {
    this.id = id;
    this.creator = creator;
    this.motion = createMotionProps({
      location: vec3.fromValues(0, 0, 0),
      rotation: quat.identity(quat.create()),
      linearVelocity: vec3.fromValues(0, 0, 0),
      angularVelocity: vec3.fromValues(0, 0, 0),
    });
    this.lastMotion = undefined;
    this.authority = creator;
    this.authority_seq = 0;
    this.snap_seq = -1;
    this.location_error = vec3.fromValues(0, 0, 0);
    this.rotation_error = quat.create();
    this.transform = mat4.create();
    this.localAABB = {
      min: vec3.fromValues(-1, -1, -1),
      max: vec3.fromValues(1, 1, 1),
    };
    this.worldAABB = copyAABB(this.localAABB);
    this.motionAABB = copyAABB(this.worldAABB);
  }

  snapLocation(location: vec3) {
    // TODO: this is a hack to see if we're setting our location for the first time
    if (vec3.length(this.motion.location) === 0) {
      this.motion.location = vec3.copy(this.motion.location, location);
      return;
    }
    let current_location = vec3.add(
      this.motion.location,
      this.motion.location,
      this.location_error
    );
    let location_error = vec3.sub(current_location, current_location, location);

    // The order of these copies is important. At this point, the calculated
    // location error actually lives in this.motion.location. So we copy it over
    // to this.location_error, then copy the new location into this.motion.location.

    this.location_error = vec3.copy(this.location_error, location_error);
    this.motion.location = vec3.copy(this.motion.location, location);
  }

  snapRotation(rotation: quat) {
    // TODO: this is a hack to see if we're setting our rotation for the first time
    let id = identity_quat;
    if (quat.equals(rotation, id)) {
      this.motion.rotation = quat.copy(this.motion.rotation, rotation);
      return;
    }
    let current_rotation = quat.mul(
      this.motion.rotation,
      this.motion.rotation,
      this.rotation_error
    );
    // sort of a hack--reuse our current rotation error quat to store the
    // rotation inverse to avoid a quat allocation
    let rotation_inverse = quat.invert(this.rotation_error, rotation);
    let rotation_error = quat.mul(
      current_rotation,
      current_rotation,
      rotation_inverse
    );

    // The order of these copies is important--see the similar comment in
    // snapLocation above.

    this.rotation_error = quat.copy(this.rotation_error, rotation_error);
    this.motion.rotation = quat.copy(this.motion.rotation, rotation);
  }

  syncPriority(firstSync: boolean): number {
    return 10;
  }

  claimAuthority(
    authority: number,
    authority_seq: number,
    snap_seq: number
  ): boolean {
    if (
      snap_seq >= this.snap_seq &&
      (this.authority_seq < authority_seq ||
        (this.authority_seq == authority_seq && authority <= this.authority))
    ) {
      this.authority = authority;
      this.authority_seq = authority_seq;
      this.snap_seq = snap_seq;
      return true;
    }
    return false;
  }

  // By default, simulate ballistic motion. Subclasses can override
  simulate(dt: number) {
    //console.log(`simulating forward ${dt} ms`);
    vec3.scale(working_vec3, this.motion.linearVelocity, dt);
    this.snapLocation(
      vec3.add(working_vec3, this.motion.location, working_vec3)
    );

    let axis = vec3.normalize(working_vec3, this.motion.angularVelocity);
    let angle = vec3.length(this.motion.angularVelocity) * dt;
    let deltaRotation = quat.setAxisAngle(working_quat, axis, angle);
    quat.normalize(deltaRotation, deltaRotation);
    quat.multiply(working_quat, deltaRotation, this.motion.rotation);
    quat.normalize(working_quat, working_quat);
    this.snapRotation(working_quat);
  }

  abstract serializeFull(buf: Serializer): void;

  abstract serializeDynamic(buf: Serializer): void;

  abstract deserializeFull(buf: Deserializer): void;

  abstract deserializeDynamic(buf: Deserializer): void;

  abstract mesh(): Mesh;

  abstract typeId(): number;
}

export interface GameEvent {
  type: number;
  id: number;
  objects: number[];
  authority: number;
}

export abstract class GameState {
  protected nextPlayerId: number;
  nextObjectId: number;
  protected renderer: Renderer;
  objects: Record<number, GameObject>;
  deletedObjects: Record<number, GameObject>;
  events: Record<number, GameEvent>;
  me: number;
  numObjects: number = 0;
  collidesWith: CollidesWith;

  constructor(renderer: Renderer) {
    this.me = 0;
    this.renderer = renderer;
    this.nextPlayerId = 0;
    this.nextObjectId = 0;
    this.objects = {};
    this.deletedObjects = {};
    this.events = {};
    this.collidesWith = new Map();
  }

  abstract playerObject(playerId: number): GameObject;

  abstract stepGame(dt: number, inputs: Inputs): void;

  abstract handleCollisions(): void;

  abstract runEvent(event: GameEvent): void;

  abstract viewMatrix(): mat4;

  abstract objectOfType(
    typeID: number,
    id: number,
    creator: number
  ): GameObject;

  addObject(obj: GameObject) {
    this.numObjects++;
    this.objects[obj.id] = obj;
    this.renderer.addObject(obj);
  }

  removeObject(obj: GameObject) {
    this.numObjects--;
    obj.deleted = true;
    delete this.objects[obj.id];
    this.deletedObjects[obj.id] = obj;
    this.renderer.removeObject(obj);
  }

  addObjectInstance(obj: GameObject, otherMesh: MeshHandle) {
    this.numObjects++;
    this.objects[obj.id] = obj;
    this.renderer.addObjectInstance(obj, otherMesh);
  }

  renderFrame() {
    this.renderer.renderFrame(this.viewMatrix());
  }

  addPlayer(): [number, GameObject] {
    let id = this.nextPlayerId;
    this.nextPlayerId += 1;
    let obj = this.playerObject(id);
    this.addObject(obj);
    return [id, obj];
  }

  newId(): number {
    return this.nextObjectId++;
  }

  recordEvent(type: number, objects: number[]) {
    // return; // TODO(@darzu): TO DEBUG this fn is costing a ton of memory
    let objs = objects.map((id) => this.objects[id] ?? this.deletedObjects[id]);
    // check to see whether we're the authority for this event
    if (this.eventAuthority(type, objs) == this.me) {
      // TODO(@darzu): DEBUGGING
      // console.log(`Recording event type=${type}`);
      let id = this.newId();
      let event = { id, type, objects, authority: this.me };
      this.events[id] = event;
      this.runEvent(event);
    }
  }

  // Subclasses can override this to handle authority differently depending on the event type
  eventAuthority(type: number, objects: GameObject[]) {
    return Math.min(...objects.map((o) => o.authority));
  }

  step(dt: number, inputs: Inputs) {
    this.stepGame(dt, inputs);

    const objs = Object.values(this.objects);

    // reduce error in location and rotation
    let identity_quat = quat.set(working_quat, 0, 0, 0, 1);

    for (let o of objs) {
      o.location_error = vec3.scale(
        o.location_error,
        o.location_error,
        ERROR_SMOOTHING_FACTOR ** dt
      );
      let location_error_magnitude = vec3.length(o.location_error);
      if (
        location_error_magnitude !== 0 &&
        location_error_magnitude < EPSILON
      ) {
        //console.log(`Object ${o.id} reached 0 location error`);
        o.location_error = vec3.set(o.location_error, 0, 0, 0);
      }
      o.rotation_error = quat.slerp(
        o.rotation_error,
        o.rotation_error,
        identity_quat,
        1 - ERROR_SMOOTHING_FACTOR ** dt
      );
      quat.normalize(o.rotation_error, o.rotation_error);
      let rotation_error_magnitude = Math.abs(
        quat.getAngle(o.rotation_error, identity_quat)
      );
      if (
        rotation_error_magnitude !== 0 &&
        rotation_error_magnitude < EPSILON
      ) {
        //console.log(`Object ${o.id} reached 0 rotation error`);
        o.rotation_error = quat.copy(o.rotation_error, identity_quat);
      }
    }

    // move, check collisions
    const physRes = stepPhysics(this.objects, dt);
    this.collidesWith = physRes.collidesWith;

    // deal with any collisions
    this.handleCollisions();

    // UPDATE DERIVED STATE:
    for (let o of objs) {
      // update transform based on new rotations and positions
      if (SMOOTH) {
        quat.mul(working_quat, o.motion.rotation, o.rotation_error);
        quat.normalize(working_quat, working_quat);
        mat4.fromRotationTranslation(
          o.transform,
          working_quat,
          vec3.add(working_vec3, o.motion.location, o.location_error)
        );
      } else {
        mat4.fromRotationTranslation(
          o.transform,
          o.motion.rotation,
          o.motion.location
        );
      }
    }
  }
}
