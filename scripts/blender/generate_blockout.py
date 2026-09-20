# Modified for Director Desk exact viewport motion meshes; see MODIFICATIONS.md.
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Render an Erin Director Desk Blender plan")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ffmpeg", required=True)
    return parser.parse_args(argv)


def load_plan(path: Path) -> dict[str, Any]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("spec") != "ailin-blender-plan" or plan.get("version") != "1.0":
        raise ValueError("Unsupported Erin Blender plan")
    if plan.get("coordinateSystem") != "blender-z-up":
        raise ValueError("Blender plan must use blender-z-up")
    return plan


def save_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def native_path(path: Path) -> Path:
    """Blender's embedded Python needs extended paths for deep Windows projects."""
    resolved = path.resolve()
    text = str(resolved)
    if sys.platform != "win32" or text.startswith("\\\\?\\"):
        return resolved
    return Path("\\\\?\\UNC\\" + text[2:] if text.startswith("\\\\") else "\\\\?\\" + text)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def rgba(value: str) -> tuple[float, float, float, float]:
    text = value.lstrip("#")
    if len(text) != 6:
        return (0.53, 0.58, 0.61, 1.0)
    return tuple(int(text[index:index + 2], 16) / 255 for index in (0, 2, 4)) + (1.0,)


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.72) -> bpy.types.Material:
    result = bpy.data.materials.new(name=name)
    result.diffuse_color = color
    result.roughness = roughness
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
    return result


def assign(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(mat)


def box(name: str, size: tuple[float, float, float], location: tuple[float, float, float], mat: bpy.types.Material,
        parent: bpy.types.Object | None = None, bevel: float = 0.025) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new(name="Soft edges", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    assign(obj, mat)
    obj.parent = parent
    return obj


def cylinder(name: str, radius: float, depth: float, location: tuple[float, float, float], mat: bpy.types.Material,
             parent: bpy.types.Object | None = None, rotation: tuple[float, float, float] = (0, 0, 0), vertices: int = 20) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    obj.parent = parent
    return obj


def sphere(name: str, radius: float, location: tuple[float, float, float], mat: bpy.types.Material,
           parent: bpy.types.Object | None = None, scale: tuple[float, float, float] = (1, 1, 1)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, mat)
    obj.parent = parent
    return obj


def label(text: str, parent: bpy.types.Object, height: float, mat: bpy.types.Material, camera: bpy.types.Object) -> None:
    curve = bpy.data.curves.new(type="FONT", name=f"LABEL_{text}")
    curve.body = text
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 0.16
    curve.extrude = 0.006
    obj = bpy.data.objects.new(f"LABEL_{text}", curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = (0, 0, height + 0.24)
    assign(obj, mat)
    constraint = obj.constraints.new(type="COPY_ROTATION")
    constraint.target = camera
    constraint.mix_mode = "REPLACE"


def root_for(entity: dict[str, Any]) -> bpy.types.Object:
    root = bpy.data.objects.new(entity["id"], None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.35
    bpy.context.scene.collection.objects.link(root)
    transform = entity["transform"]
    root.location = transform["position"]
    root.rotation_mode = "XYZ"
    root.rotation_euler[2] = transform["rotationZ"]
    return root


def animate_root(root: bpy.types.Object, entity: dict[str, Any]) -> None:
    marks = entity.get("marks", [])
    if not marks:
        return
    for mark in marks:
        root.location = mark["position"]
        root.rotation_euler[2] = mark.get("headingRadians", entity["transform"]["rotationZ"])
        root.keyframe_insert(data_path="location", frame=mark["frame"])
        root.keyframe_insert(data_path="rotation_euler", frame=mark["frame"])


def actor_pose_height(mark: dict[str, Any]) -> float:
    joints = mark.get("joints", {})
    if isinstance(joints.get("bodyHeight"), (int, float)):
        return max(0.28, min(1.08, float(joints["bodyHeight"])))
    return {
        "crouch": 0.62,
        "sit": 0.68,
        "lie": 0.28,
        "fall": 0.42,
    }.get(mark.get("gait"), 1.0)


def animate_actor_pose(parts: dict[str, Any], marks: list[dict[str, Any]], scale: float) -> None:
    if not marks:
        return
    torso = parts["torso"]
    hips = parts["hips"]
    head = parts["head"]
    facing = parts["facing"]
    arms = parts["arms"]
    legs = parts["legs"]
    shins = parts["shins"]
    feet = parts["feet"]
    for mark in marks:
        frame = mark["frame"]
        joints = mark.get("joints", {})
        height = actor_pose_height(mark)
        crouch = max(0.0, min(1.0, (1.0 - height) / 0.38))
        # Keep the upper body rigid: independently lowering the head more than
        # the torso made sitting actors' heads intersect their shoulders.
        sitting = mark.get("gait") == "sit"
        upper_offset = -0.26 if sitting else 0.41 * (height - 1.0)
        torso.location.z = (1.12 + upper_offset) * scale
        hips.location.z = (0.75 + upper_offset) * scale
        head.location.z = (1.62 + upper_offset) * scale
        facing.location.z = head.location.z
        arm_lift = joints.get("armLiftDegrees") if isinstance(joints, dict) else None
        default_arm_angle = math.radians(float(arm_lift)) if isinstance(arm_lift, (int, float)) else math.radians(18) * crouch
        for index, arm in enumerate(arms):
            side_arm_lift = joints.get("leftArmLiftDegrees" if index == 0 else "rightArmLiftDegrees") if isinstance(joints, dict) else None
            arm_angle = math.radians(float(side_arm_lift)) if isinstance(side_arm_lift, (int, float)) else default_arm_angle
            arm.location.z = (1.1 + upper_offset) * scale
            arm.rotation_euler[0] = arm_angle
        for index, leg in enumerate(legs):
            leg.location.y = -0.1825 * scale if sitting else 0
            leg.location.z = (0.43 if sitting else 0.19 + 0.19 * height) * scale
            leg.scale.z = 0.5 if sitting else 0.52 + 0.48 * height
            leg.rotation_euler[0] = math.pi / 2 if sitting else math.radians(42) * crouch * (1 if index == 0 else -1)
            shins[index].scale = (1, 1, 1) if sitting else (0, 0, 0)
            feet[index].location.y = (-0.44 if sitting else -0.075) * scale
        for obj in (torso, hips, head, facing, *arms, *legs, *shins, *feet):
            obj.keyframe_insert(data_path="location", frame=frame)
            obj.keyframe_insert(data_path="rotation_euler", frame=frame)
            obj.keyframe_insert(data_path="scale", frame=frame)


def motion_actor(entity: dict[str, Any]) -> None:
    """Baked viewport meshes already include world position, scale and heading."""
    for index, item in enumerate(entity["motionMeshes"]):
        vertices = item["vertices"]
        indices = item["triangles"]
        mesh = bpy.data.meshes.new(f"{entity['id']}_MOTION_{index}")
        mesh.from_pydata([vertices[i:i + 3] for i in range(0, len(vertices), 3)], [],
                         [indices[i:i + 3] for i in range(0, len(indices), 3)])
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        assign(obj, material(f"{mesh.name}_MAT", rgba(item["color"])))
        obj.rotation_mode = "QUATERNION"
        previous = None
        for frame, values in enumerate(item["matrices"], start=1):
            world = Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()
            location, rotation, scale = world.decompose()
            if previous is not None and previous.dot(rotation) < 0:
                rotation.negate()
            obj.location, obj.rotation_quaternion, obj.scale = location, rotation, scale
            for channel in ("location", "rotation_quaternion", "scale"):
                obj.keyframe_insert(data_path=channel, frame=frame)
            previous = rotation.copy()


def actor(entity: dict[str, Any], mats: dict[str, bpy.types.Material], camera: bpy.types.Object) -> None:
    if entity.get("motionMeshes"):
        motion_actor(entity)
        return
    root = root_for(entity)
    height = max(0.8, entity["dimensions"]["height"])
    scale = height / 1.76
    accent = material(f"MAT_{entity['id']}_ACCENT", rgba(entity["accent"]), 0.58)
    torso = box(f"{entity['id']}_TORSO", (0.42 * scale, 0.25 * scale, 0.66 * scale), (0, 0, 1.12 * scale), accent, root, 0.05)
    hips = box(f"{entity['id']}_HIPS", (0.35 * scale, 0.23 * scale, 0.22 * scale), (0, 0, 0.75 * scale), mats["clay_dark"], root, 0.035)
    head = sphere(f"{entity['id']}_HEAD", 0.145 * scale, (0, 0, 1.62 * scale), mats["clay_light"], root, (0.92, 0.96, 1.08))
    facing = box(f"{entity['id']}_FACING", (0.07 * scale, 0.09 * scale, 0.06 * scale), (0, -0.14 * scale, 1.62 * scale), accent, root, 0.012)
    arms: list[bpy.types.Object] = []
    legs: list[bpy.types.Object] = []
    shins: list[bpy.types.Object] = []
    feet: list[bpy.types.Object] = []
    for side, sign in (("L", -1), ("R", 1)):
        arm = cylinder(f"{entity['id']}_ARM_{side}", 0.06 * scale, 0.62 * scale, (sign * 0.27 * scale, 0, 1.1 * scale), mats["clay_light"], root)
        leg = cylinder(f"{entity['id']}_LEG_{side}", 0.08 * scale, 0.73 * scale, (sign * 0.11 * scale, 0, 0.38 * scale), mats["clay_dark"], root)
        foot = box(f"{entity['id']}_FOOT_{side}", (0.14 * scale, 0.28 * scale, 0.09 * scale), (sign * 0.11 * scale, -0.075 * scale, 0.045 * scale), mats["charcoal"], root, 0.02)
        shin = cylinder(f"{entity['id']}_SHIN_{side}", 0.07 * scale, 0.365 * scale, (sign * 0.11 * scale, -0.365 * scale, 0.23 * scale), mats["clay_dark"], root)
        shin.scale = (0, 0, 0)
        arms.append(arm)
        legs.append(leg)
        shins.append(shin)
        feet.append(foot)
    marks = entity.get("marks", [])
    moving_marks = [mark for mark in marks if mark.get("gait") in {"walk", "jog", "run"}]
    if len(moving_marks) > 1:
        first = marks[0]["frame"]
        last = moving_marks[-1]["frame"]
        for frame in range(first, last + 1, 8):
            phase = 1 if ((frame - first) // 8) % 2 == 0 else -1
            for index, limb in enumerate((*arms, *legs)):
                limb.rotation_euler[0] = math.radians(16) * phase * (1 if index % 2 == 0 else -1)
                limb.keyframe_insert(data_path="rotation_euler", frame=frame)
        for limb in (*arms, *legs):
            limb.rotation_euler[0] = 0
            limb.keyframe_insert(data_path="rotation_euler", frame=last)
    animate_actor_pose({"torso": torso, "hips": hips, "head": head, "facing": facing, "arms": arms, "legs": legs, "shins": shins, "feet": feet}, marks, scale)
    animate_root(root, entity)
    label(entity["name"], root, height, accent, camera)


def semantic_static(entity: dict[str, Any], mats: dict[str, bpy.types.Material], camera: bpy.types.Object) -> None:
    root = root_for(entity)
    name = entity["name"].lower()
    asset_id = entity["assetId"].lower()
    h = max(0.08, entity["dimensions"]["height"])
    r = max(0.08, entity["dimensions"]["footprint"])
    accent = material(f"MAT_{entity['id']}_ACCENT", rgba(entity["accent"]), 0.64)

    if "工具箱" in name or "toolcase" in name or "suitcase" in asset_id or "briefcase" in asset_id:
        body_width = max(0.42, r * 1.55)
        body_depth = max(0.22, r * 0.82)
        body_height = max(0.52, h * 0.78)
        box(f"{entity['id']}_CASE", (body_width, body_depth, body_height), (0, 0, body_height / 2 + 0.09), mats["charcoal"], root, 0.075)
        for x in (-body_width * 0.36, body_width * 0.36):
            for y in (-body_depth * 0.34, body_depth * 0.34):
                cylinder(f"{entity['id']}_WHEEL", 0.055, 0.045, (x, y, 0.055), mats["metal_dark"], root, (math.pi / 2, 0, 0), 20)
        handle_height = body_height + 0.72
        for x in (-body_width * 0.23, body_width * 0.23):
            cylinder(f"{entity['id']}_HANDLE_RAIL", 0.018, 0.68, (x, 0, body_height + 0.36), mats["metal"], root, vertices=16)
        box(f"{entity['id']}_HANDLE_GRIP", (body_width * 0.58, 0.07, 0.07), (0, 0, handle_height), mats["charcoal"], root, 0.025)
    elif "门框" in name or "gate frame" in name:
        gate_width = max(3.0, r * 1.6)
        gate_height = max(2.6, h)
        for x in (-gate_width / 2, gate_width / 2):
            box(f"{entity['id']}_POST", (0.32, 0.42, gate_height), (x, 0, gate_height / 2), mats["wall"], root, 0.025)
        box(f"{entity['id']}_LINTEL", (gate_width + 0.34, 0.48, 0.38), (0, 0, gate_height), mats["wood_dark"], root, 0.025)
        box(f"{entity['id']}_THRESHOLD", (gate_width, 0.42, 0.12), (0, 0, 0.06), mats["stone"], root, 0.015)
    elif "正立面" in name or "facade" in name:
        facade_width = max(5.4, r * 3.2)
        facade_height = max(3.1, h)
        opening_width = min(1.45, facade_width * 0.28)
        wing_width = (facade_width - opening_width) / 2
        for x in (-(opening_width + wing_width) / 2, (opening_width + wing_width) / 2):
            box(f"{entity['id']}_WING", (wing_width, 0.48, facade_height), (x, 0, facade_height / 2), mats["wood_dark"], root, 0.025)
        box(f"{entity['id']}_HEADER", (opening_width, 0.48, facade_height - 2.15), (0, 0, 2.15 + (facade_height - 2.15) / 2), mats["wood_dark"], root, 0.02)
        box(f"{entity['id']}_STEP", (opening_width + 0.7, 0.8, 0.18), (0, -0.18, 0.09), mats["stone"], root, 0.015)
        box(f"{entity['id']}_ROOF", (facade_width + 0.8, 1.1, 0.22), (0, 0, facade_height + 0.18), mats["roof"], root, 0.02)
    elif "脚手架" in name or "scaffold" in asset_id:
        scaffold_width = max(2.2, r * 1.8)
        scaffold_depth = max(0.9, r * 0.72)
        scaffold_height = max(3.2, h)
        for x in (-scaffold_width / 2, scaffold_width / 2):
            for y in (-scaffold_depth / 2, scaffold_depth / 2):
                cylinder(f"{entity['id']}_POST", 0.045, scaffold_height, (x, y, scaffold_height / 2), mats["metal_dark"], root, vertices=12)
        for z in (0.8, 1.65, 2.5, scaffold_height):
            box(f"{entity['id']}_RAIL", (scaffold_width, 0.07, 0.07), (0, -scaffold_depth / 2, z), mats["metal_dark"], root, 0.01)
        box(f"{entity['id']}_MESH", (scaffold_width, 0.035, scaffold_height), (0, scaffold_depth / 2, scaffold_height / 2), mats["mesh_green"], root, 0.01)
    elif asset_id == "prop.trafficcone":
        box(f"{entity['id']}_TRAFFIC_CONE_BASE", (0.38, 0.38, 0.07), (0, 0, 0.035), mats["charcoal"], root, 0.018)
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.20, radius2=0.045, depth=max(0.4, h), location=(0, 0, max(0.4, h) / 2 + 0.07))
        cone = bpy.context.object
        cone.name = f"{entity['id']}_TRAFFIC_CONE_BODY"
        assign(cone, material("MAT_TRAFFIC_CONE_ORANGE", (0.95, 0.24, 0.035, 1), 0.56))
        cone.parent = root
    elif "木箱" in name or "砖垛" in name or "crate" in asset_id:
        box(f"{entity['id']}_CRATE_A", (0.95, 0.75, 0.72), (-0.38, 0, 0.36), mats["wood"], root, 0.025)
        box(f"{entity['id']}_CRATE_B", (0.78, 0.68, 0.58), (0.48, 0.06, 0.29), mats["stone"], root, 0.018)
        box(f"{entity['id']}_CRATE_C", (0.72, 0.62, 0.5), (-0.28, 0.04, 0.97), mats["wood_dark"], root, 0.02)
    elif "配电" in name or "electrical" in name:
        box(f"{entity['id']}_PANEL", (0.18, 1.15, 1.45), (0, 0, 0.68), mats["panel"], root, 0.03)
        for offset in (-0.3, 0, 0.3):
            box(f"{entity['id']}_SWITCH", (0.05, 0.16, 0.12), (-0.1, offset, 0.68), mats["charcoal"], root, 0.01)
    elif "管线" in name or "conduit" in name:
        cylinder(f"{entity['id']}_CONDUIT_A", 0.035, 2.7, (0, -0.3, 0), mats["metal_dark"], root)
        cylinder(f"{entity['id']}_CONDUIT_B", 0.035, 2.7, (0, 0.3, 0), mats["metal_dark"], root)
    elif "神像" in name or "statue" in asset_id:
        if "遮布" in name or "covered" in name:
            bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=max(0.36, r), radius2=max(0.15, r * 0.42), depth=max(0.8, h), location=(0, 0, 0))
            body = bpy.context.object
            body.name = f"{entity['id']}_COVERED_BODY"
            assign(body, mats["cloth"])
            body.parent = root
            sphere(f"{entity['id']}_HEAD", max(0.16, r * 0.45), (0, 0, h * 0.58), mats["cloth"], root, (0.88, 0.9, 1.05))
        else:
            statue_mat = material(f"MAT_{entity['id']}_WOOD", (0.50, 0.30, 0.17, 1), 0.76)
            box(f"{entity['id']}_BASE", (r * 1.65, r * 1.3, 0.16), (0, 0, 0.08), mats["wood_dark"], root, 0.04)
            sphere(f"{entity['id']}_BODY", max(0.24, r * 0.78), (0, 0, h * 0.47), statue_mat, root, (0.92, 0.72, 1.18))
            sphere(f"{entity['id']}_HEAD", max(0.14, r * 0.4), (0, 0, h * 0.84), statue_mat, root, (0.9, 0.92, 1.04))
            box(f"{entity['id']}_REAR_SEAM", (0.025, 0.025, h * 0.62), (0, -r * 0.58, h * 0.48), mats["charcoal"], root, 0.005)
            for index, z_offset in enumerate((0.35, 0.47, 0.59), start=1):
                cut = box(f"{entity['id']}_REAR_CUT_{index}", (r * 0.42, 0.026, 0.018), (0.09, -r * 0.59, h * z_offset), mats["charcoal"], root, 0.003)
                cut.rotation_euler[1] = math.radians(-10)
    elif "平台" in name or "restorationplatform" in asset_id:
        box(f"{entity['id']}_TOP", (r * 2, r * 1.4, max(0.16, h * 0.35)), (0, 0, 0), mats["metal"], root, 0.06)
        for x in (-r * 0.7, r * 0.7):
            for y in (-r * 0.45, r * 0.45):
                cylinder(f"{entity['id']}_WHEEL", 0.1, 0.08, (x, y, -0.16), mats["charcoal"], root, (0, math.pi / 2, 0))
    elif "无影灯" in name or "overhead" in name:
        cylinder(f"{entity['id']}_ARM", 0.045, 1.0, (0, 0, -0.5), mats["metal_dark"], root)
        cylinder(f"{entity['id']}_HEAD", 0.46, 0.12, (0, 0, -1.05), mats["lamp"], root, (math.pi / 2, 0, 0), 32)
    elif "检查灯" in name or "inspection" in name:
        cylinder(f"{entity['id']}_BASE", 0.36, 0.08, (0, 0, 0.05), mats["metal_dark"], root, vertices=24)
        cylinder(f"{entity['id']}_POLE", 0.045, 2.1, (0, 0, 1.1), mats["metal_dark"], root)
        cylinder(f"{entity['id']}_HEAD", 0.32, 0.13, (-0.16, -0.12, 2.15), mats["lamp"], root, (math.pi / 2, 0, math.radians(-18)), 24)
    elif "高窗" in name or "window" in asset_id:
        box(f"{entity['id']}_GLASS", (2.05, 0.08, 1.0), (0, 0, 0), mats["glass"], root, 0.02)
        box(f"{entity['id']}_FRAME_H", (2.18, 0.12, 0.07), (0, -0.06, 0), mats["metal_dark"], root, 0)
        box(f"{entity['id']}_FRAME_V", (0.07, 0.12, 1.08), (0, -0.06, 0), mats["metal_dark"], root, 0)
    elif "柜" in name or "cabinet" in asset_id:
        box(f"{entity['id']}_CABINET", (0.62, 2.35, 2.3), (0, 0, 0), mats["cabinet"], root, 0.035)
    elif "矮门" in name or "door" in asset_id:
        box(f"{entity['id']}_DOOR", (0.2, 1.65, min(2.1, max(1.4, h))), (0, 0, 0), mats["wood"], root, 0.04)
        cylinder(f"{entity['id']}_HANDLE", 0.04, 0.1, (0.14, 0.52, 0), mats["metal_dark"], root, (0, math.pi / 2, 0))
    elif "矮墙" in name or "half wall" in name:
        box(f"{entity['id']}_HALF_WALL", (4.3, 0.22, 1.05), (0, 0, 0), mats["half_wall"], root, 0.03)
    elif asset_id == "furniture.chair":
        # Same ground origin, forward direction and proportions as the editable
        # Three.js chair. dimensions already contain the entity scale.
        s = h / 0.9
        box(f"{entity['id']}_SEAT", (0.42*s, 0.42*s, 0.06*s), (0, 0, 0.45*s), mats["wood"], root, 0.015*s)
        box(f"{entity['id']}_BACK", (0.42*s, 0.05*s, 0.45*s), (0, 0.19*s, 0.68*s), mats["wood"], root, 0.015*s)
        for x in (-0.16*s, 0.16*s):
            for y in (-0.16*s, 0.16*s):
                box(f"{entity['id']}_LEG_{x}_{y}", (0.05*s, 0.05*s, 0.45*s), (x, y, 0.225*s), mats["wood_dark"], root, 0.01*s)
    elif asset_id == "furniture.diningtable":
        # This catalog asset has a ground origin. Historical semantic table
        # props below retain their separately authored tabletop-origin rule.
        s = h / 0.76
        box(f"{entity['id']}_TOP", (1.8*s, 0.9*s, 0.05*s), (0, 0, 0.76*s), mats["wood"], root, 0.02*s)
        for x in (-0.8*s, 0.8*s):
            for y in (-0.35*s, 0.35*s):
                box(f"{entity['id']}_LEG_{x}_{y}", (0.08*s, 0.08*s, 0.76*s), (x, y, 0.38*s), mats["wood_dark"], root, 0.01*s)
    elif asset_id == "furniture.sidetable":
        # Ground-origin café table: the previous generic table rule treated the
        # root as its tabletop and buried the legs below the floor.
        table_height = max(0.5, h)
        tabletop_radius = max(0.32, r * 1.25)
        cylinder(f"{entity['id']}_ROUND_TOP", tabletop_radius, 0.07, (0, 0, table_height), mats["wood"], root, vertices=40)
        cylinder(f"{entity['id']}_PEDESTAL", 0.075, table_height - 0.06, (0, 0, table_height / 2), mats["metal_dark"], root, vertices=24)
        cylinder(f"{entity['id']}_BASE", tabletop_radius * 0.58, 0.055, (0, 0, 0.03), mats["metal_dark"], root, vertices=32)
    elif "桌" in name or "table" in asset_id:
        box(f"{entity['id']}_TOP", (max(1.0, r * 2), max(0.6, r), 0.12), (0, 0, 0), mats["wood"], root, 0.03)
        for x in (-r * 0.75, r * 0.75):
            for y in (-r * 0.32, r * 0.32):
                box(f"{entity['id']}_LEG", (0.1, 0.1, max(0.45, h)), (x, y, -h / 2), mats["wood_dark"], root, 0.015)
    elif "守则" in name or "openbook" in asset_id or "open book" in name:
        page_width = max(0.2, r * 0.95)
        page_depth = max(0.24, r * 1.25)
        left = box(f"{entity['id']}_PAGE_LEFT", (page_width, page_depth, 0.025), (-page_width * 0.51, 0, 0), mats["paper"], root, 0.012)
        right = box(f"{entity['id']}_PAGE_RIGHT", (page_width, page_depth, 0.025), (page_width * 0.51, 0, 0), mats["paper"], root, 0.012)
        left.rotation_euler[1] = math.radians(-7)
        right.rotation_euler[1] = math.radians(7)
        box(f"{entity['id']}_BINDING", (0.035, page_depth, 0.04), (0, 0, -0.01), mats["wood_dark"], root, 0.008)
    elif entity["geometry"] == "vehicle":
        box(f"{entity['id']}_BODY", (r * 1.8, r * 3.2, h * 0.55), (0, 0, h * 0.3), accent, root, 0.08)
        box(f"{entity['id']}_CAB", (r * 1.45, r * 1.5, h * 0.45), (0, 0.15, h * 0.7), mats["clay_light"], root, 0.06)
    else:
        box(f"{entity['id']}_BLOCK", (r * 2, r * 2, h), (0, 0, h / 2), accent, root, min(0.05, r * 0.15))
    animate_root(root, entity)
    if entity["geometry"] == "placeholder":
        label(entity["name"], root, max(h, 0.5), accent, camera)


def scene_bounds(plan: dict[str, Any]) -> tuple[float, float, float, float]:
    points: list[list[float]] = []
    for entity in plan["entities"]:
        if entity["geometry"] == "environment":
            continue
        points.append(entity["transform"]["position"])
        points.extend(mark["position"] for mark in entity.get("marks", []))
    points.extend(mark["position"] for mark in plan.get("camera", {}).get("marks", []))
    if not points:
        return (-5, 5, -6, 6)
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    center_x = (min(xs) + max(xs)) / 2
    center_y = (min(ys) + max(ys)) / 2
    width = max(10, max(xs) - min(xs) + 2)
    depth = max(12, max(ys) - min(ys) + 2)
    return (center_x - width / 2, center_x + width / 2, center_y - depth / 2, center_y + depth / 2)


def floor_grid(plan: dict[str, Any], mats: dict[str, bpy.types.Material], floor_material: bpy.types.Material) -> tuple[float, float, float, float]:
    min_x, max_x, min_y, max_y = scene_bounds(plan)
    width = max_x - min_x
    depth = max_y - min_y
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    box("GROUND", (width, depth, 0.12), (center_x, center_y, -0.06), floor_material, bevel=0)
    for x in range(math.floor(min_x), math.ceil(max_x) + 1):
        box(f"GRID_X_{x}", (0.012, depth, 0.006), (x, center_y, 0.008), mats["grid"], bevel=0)
    for y in range(math.floor(min_y), math.ceil(max_y) + 1):
        box(f"GRID_Y_{y}", (width, 0.012, 0.006), (center_x, y, 0.008), mats["grid"], bevel=0)
    return min_x, max_x, min_y, max_y


def room(plan: dict[str, Any], mats: dict[str, bpy.types.Material]) -> None:
    min_x, max_x, min_y, max_y = floor_grid(plan, mats, mats["floor"])
    width = max_x - min_x
    depth = max_y - min_y
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    height = 4.8
    box("ROOM_CEILING", (width, depth, 0.1), (center_x, center_y, height + 0.05), mats["ceiling"], bevel=0)
    camera_marks = plan["camera"].get("marks", [])
    camera_x = sum(mark["position"][0] for mark in camera_marks) / max(1, len(camera_marks)) if camera_marks else center_x
    camera_y = sum(mark["position"][1] for mark in camera_marks) / max(1, len(camera_marks)) if camera_marks else min_y
    distances = {
        "min_x": abs(camera_x - min_x), "max_x": abs(camera_x - max_x),
        "min_y": abs(camera_y - min_y), "max_y": abs(camera_y - max_y),
    }
    open_side = min(distances, key=distances.get)
    if open_side != "min_x": box("WEST_WALL", (0.14, depth, height), (min_x, center_y, height / 2), mats["wall"], bevel=0)
    if open_side != "max_x": box("EAST_WALL", (0.14, depth, height), (max_x, center_y, height / 2), mats["wall"], bevel=0)
    if open_side != "min_y": box("SOUTH_WALL", (width, 0.14, height), (center_x, min_y, height / 2), mats["wall"], bevel=0)
    if open_side != "max_y": box("NORTH_WALL", (width, 0.14, height), (center_x, max_y, height / 2), mats["wall"], bevel=0)


def environment_shell(plan: dict[str, Any], mats: dict[str, bpy.types.Material]) -> None:
    exterior_assets = {
        "env.backyard", "env.beach", "env.cemetery", "env.cityStreet", "env.constructionSite",
        "env.desert", "env.downtown", "env.field", "env.forest", "env.gasStation",
        "env.houseExterior", "env.outdoorMall", "env.park", "env.parkingLot", "env.playgroundPark",
        "env.residentialStreet", "env.rooftop", "env.sky", "env.stadium", "env.stripMall"
    }
    environment_id = plan.get("environment", {}).get("assetId")
    if environment_id in exterior_assets:
        min_x, max_x, min_y, max_y = floor_grid(plan, mats, mats["wet_brick"])
        if environment_id == "env.cityStreet":
            depth = max_y - min_y
            center_y = (min_y + max_y) / 2
            sidewalk_width = 1.4
            for side, x in (("L", min_x + sidewalk_width / 2), ("R", max_x - sidewalk_width / 2)):
                box(f"CITY_STREET_SIDEWALK_{side}", (sidewalk_width, depth, 0.18), (x, center_y, 0.09), mats["stone"], bevel=0.015)
                curb_x = x + sidewalk_width / 2 if side == "L" else x - sidewalk_width / 2
                box(f"CITY_STREET_CURB_{side}", (0.18, depth, 0.24), (curb_x, center_y, 0.12), mats["paper"], bevel=0.01)
            for index, y in enumerate(range(math.floor(min_y) + 1, math.ceil(max_y), 2), start=1):
                box(f"CITY_STREET_LANE_{index}", (0.10, 0.85, 0.025), (0, y, 0.02), mats["paper"], bevel=0.005)
        return
    room(plan, mats)
    if environment_id == "env.warehouse":
        min_x, max_x, _, max_y = scene_bounds(plan)
        center_x = (min_x + max_x) / 2
        rack_y = max_y - 0.28
        for rack_index, x in enumerate((center_x - 2.6, center_x + 2.6), start=1):
            for side in (-1, 1):
                box(f"WAREHOUSE_BACK_RACK_{rack_index}_POST_{side}", (0.12, 0.22, 3.4), (x + side * 1.05, rack_y, 1.7), mats["metal_dark"], bevel=0.01)
            for shelf_index, height in enumerate((0.65, 1.65, 2.65), start=1):
                box(f"WAREHOUSE_BACK_RACK_{rack_index}_SHELF_{shelf_index}", (2.3, 0.5, 0.10), (x, rack_y, height), mats["metal"], bevel=0.012)
    if environment_id == "env.coffeeShop":
        min_x, max_x, _, max_y = scene_bounds(plan)
        center_x = (min_x + max_x) / 2
        shelf_width = min(5.2, max_x - min_x - 1.2)
        box("CAFE_BACK_PANEL", (shelf_width + 0.7, 0.10, 2.2), (center_x, max_y - 0.16, 2.35), mats["cabinet"], bevel=0.025)
        for level, height in enumerate((1.65, 2.25, 2.85), start=1):
            box(f"CAFE_BACK_SHELF_{level}", (shelf_width, 0.32, 0.08), (center_x, max_y - 0.34, height), mats["wood"], bevel=0.018)
            for index, offset in enumerate((-1.6, -0.8, 0, 0.8, 1.6), start=1):
                cylinder(f"CAFE_CUP_{level}_{index}", 0.09, 0.22, (center_x + offset, max_y - 0.47, height + 0.15), mats["clay_light"], vertices=18)


def area_light(name: str, location: Vector, target: Vector, energy: float, size: float,
               color: tuple[float, float, float]) -> bpy.types.Object:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (target - location).to_track_quat("-Z", "Y").to_euler()
    return light


def advanced_light_rig(plan: dict[str, Any]) -> None:
    """Fast three-point lighting that makes advanced previews legible without pretending to be final footage."""
    actor_points = [
        Vector(point)
        for entity in plan["entities"] if entity["geometry"] == "actor"
        for point in ([entity["transform"]["position"]] + [mark["position"] for mark in entity.get("marks", [])])
    ]
    target = sum(actor_points, Vector()) / len(actor_points) if actor_points else Vector((0, 0, 1))
    target.z = max(0.9, target.z + 0.9)
    camera_marks = plan.get("camera", {}).get("marks", [])
    camera_point = Vector(camera_marks[0]["position"]) if camera_marks else Vector((0, -6, 2))
    forward = Vector((camera_point.x - target.x, camera_point.y - target.y, 0))
    if forward.length < 0.1:
        forward = Vector((0, -1, 0))
    forward.normalize()
    side = Vector((-forward.y, forward.x, 0))
    area_light("ADVANCED_KEY_LIGHT", target + forward * 2.8 + side * 2.7 + Vector((0, 0, 2.5)), target, 520, 3.2, (1.0, 0.78, 0.58))
    area_light("ADVANCED_FILL_LIGHT", target + forward * 1.5 - side * 3.0 + Vector((0, 0, 1.5)), target, 260, 3.0, (0.55, 0.72, 1.0))
    area_light("ADVANCED_RIM_LIGHT", target - forward * 3.2 + side * 0.7 + Vector((0, 0, 2.7)), target, 420, 2.6, (0.72, 0.84, 1.0))
    if actor_points and max(point.y for point in actor_points) - min(point.y for point in actor_points) > 4:
        start_target = min(actor_points, key=lambda point: point.y).copy()
        end_target = max(actor_points, key=lambda point: point.y).copy()
        start_target.z = end_target.z = 1.0
        area_light("ADVANCED_PATH_LIGHT_START", start_target + Vector((0, 0, 4.2)), start_target, 520, 4.5, (0.68, 0.78, 1.0))
        area_light("ADVANCED_PATH_LIGHT_END", end_target + Vector((0, 0, 4.2)), end_target, 520, 4.5, (1.0, 0.76, 0.55))


def camera_from(plan: dict[str, Any]) -> bpy.types.Object:
    data = bpy.data.cameras.new("SHOT_CAMERA")
    data.sensor_width = plan["camera"].get("sensorWidthMm", 36)
    if plan["camera"].get("sensorFit") == "HORIZONTAL":
        data.sensor_fit = "HORIZONTAL"
    camera = bpy.data.objects.new("SHOT_CAMERA", data)
    bpy.context.scene.collection.objects.link(camera)
    marks = plan["camera"].get("marks", [])
    if marks and all(mark.get("worldMatrix") for mark in marks):
        camera.rotation_mode = "QUATERNION"
        previous = None
        for mark in marks:
            values = mark["worldMatrix"]
            camera.matrix_world = Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()
            if previous is not None and previous.dot(camera.rotation_quaternion) < 0:
                camera.rotation_quaternion.negate()
            camera.data.lens = mark["focalLengthMm"]
            camera.keyframe_insert(data_path="location", frame=mark["frame"])
            camera.keyframe_insert(data_path="rotation_quaternion", frame=mark["frame"])
            camera.data.keyframe_insert(data_path="lens", frame=mark["frame"])
            previous = camera.rotation_quaternion.copy()
        bpy.context.scene.camera = camera
        return camera
    target = bpy.data.objects.new("SHOT_CAMERA_TARGET", None)
    bpy.context.scene.collection.objects.link(target)
    constraint = camera.constraints.new(type="TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    marks = plan["camera"].get("marks", [])
    if not marks:
        marks = [{"frame": 1, "position": [0, -8, 2.2], "aimAt": [0, 0, 1.2], "focalLengthMm": 35, "rollRadians": 0}]
    for mark in marks:
        frame = mark["frame"]
        camera.location = mark["position"]
        camera.data.lens = mark["focalLengthMm"]
        camera.rotation_euler[2] = mark.get("rollRadians", 0)
        target.location = mark["aimAt"]
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.data.keyframe_insert(data_path="lens", frame=frame)
        target.keyframe_insert(data_path="location", frame=frame)
    bpy.context.scene.camera = camera
    return camera


def configure(plan: dict[str, Any]) -> None:
    scene = bpy.context.scene
    shot = plan["shot"]
    scene.frame_start = shot["frameStart"]
    scene.frame_end = shot["frameEnd"]
    scene.render.fps = shot["fps"]
    scene.render.fps_base = 1
    scene.render.resolution_x = shot["resolution"]["width"]
    scene.render.resolution_y = shot["resolution"]["height"]
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.055, 0.065, 0.085, 1)
        background.inputs["Strength"].default_value = 0.24


def render(plan: dict[str, Any], output: Path, ffmpeg: str) -> None:
    scene = bpy.context.scene
    outputs = plan["outputs"]
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / outputs["blend"]), check_existing=False)
    middle = round((plan["shot"]["frameStart"] + plan["shot"]["frameEnd"]) / 2)
    for frame, key in ((plan["shot"]["frameStart"], "startFrame"), (middle, "middleFrame"), (plan["shot"]["frameEnd"], "endFrame")):
        scene.frame_set(frame)
        scene.render.filepath = str(output / outputs[key])
        bpy.ops.render.render(write_still=True)
    frames = output / "frames"
    frames.mkdir(exist_ok=True)
    start = plan["shot"]["frameStart"]
    end = plan["shot"]["frameEnd"]
    total = end - start + 1
    for index, frame in enumerate(range(start, end + 1), start=1):
        scene.frame_set(frame)
        scene.render.filepath = str(frames / f"frame_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"AILIN_BLENDER_PROGRESS={index}/{total}", flush=True)
    subprocess.run([
        str(ffmpeg), "-y", "-framerate", str(plan["shot"]["fps"]), "-start_number", str(start),
        "-i", str(frames / "frame_%04d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(plan["shot"]["fps"]), "-movflags", "+faststart",
        str(output / outputs["video"])
    ], check=True)


def main() -> None:
    args = parse_args()
    plan_path = native_path(Path(args.plan))
    output = native_path(Path(args.output))
    ffmpeg_path = Path(args.ffmpeg)
    ffmpeg = str(ffmpeg_path.resolve()) if ffmpeg_path.is_absolute() else args.ffmpeg
    plan = load_plan(plan_path)
    if ffmpeg_path.is_absolute() and not ffmpeg_path.is_file():
        raise FileNotFoundError(f"FFmpeg not found: {ffmpeg}")
    reset_scene()
    configure(plan)
    mats = {
        "wall": material("MAT_WALL", (0.38, 0.41, 0.46, 1)),
        "ceiling": material("MAT_CEILING", (0.30, 0.32, 0.36, 1)),
        "floor": material("MAT_FLOOR", (0.20, 0.23, 0.27, 1)),
        "grid": material("MAT_GRID", (0.055, 0.07, 0.09, 1)),
        "clay_light": material("MAT_CLAY_LIGHT", (0.78, 0.78, 0.75, 1)),
        "clay_dark": material("MAT_CLAY_DARK", (0.44, 0.46, 0.46, 1)),
        "charcoal": material("MAT_CHARCOAL", (0.08, 0.09, 0.10, 1)),
        "metal": material("MAT_METAL", (0.45, 0.49, 0.51, 1), 0.46),
        "metal_dark": material("MAT_METAL_DARK", (0.18, 0.21, 0.23, 1), 0.42),
        "cloth": material("MAT_CLOTH", (0.84, 0.82, 0.76, 1), 0.95),
        "lamp": material("MAT_LAMP", (0.82, 0.82, 0.78, 1), 0.52),
        "panel": material("MAT_PANEL", (0.28, 0.32, 0.32, 1), 0.52),
        "glass": material("MAT_GLASS", (0.22, 0.44, 0.57, 1), 0.34),
        "cabinet": material("MAT_CABINET", (0.32, 0.29, 0.24, 1)),
        "wood": material("MAT_WOOD", (0.40, 0.25, 0.14, 1)),
        "wood_dark": material("MAT_WOOD_DARK", (0.23, 0.14, 0.09, 1)),
        "half_wall": material("MAT_HALF_WALL", (0.42, 0.44, 0.45, 1)),
        "paper": material("MAT_PAPER", (0.82, 0.78, 0.67, 1), 0.92),
        "stone": material("MAT_STONE", (0.36, 0.38, 0.39, 1), 0.86),
        "roof": material("MAT_ROOF", (0.16, 0.18, 0.19, 1), 0.78),
        "mesh_green": material("MAT_MESH_GREEN", (0.25, 0.37, 0.33, 1), 0.88),
        "wet_brick": material("MAT_WET_BRICK", (0.23, 0.25, 0.25, 1), 0.58),
    }
    camera = camera_from(plan)
    environment_shell(plan, mats)
    advanced_light_rig(plan)
    for entity in plan["entities"]:
        if entity["geometry"] == "environment":
            continue
        if entity["geometry"] == "actor":
            actor(entity, mats, camera)
        else:
            semantic_static(entity, mats, camera)
    render(plan, output, ffmpeg)
    state = {
        "spec": "ailin-blender-state",
        "version": "1.0",
        "generator": {"blenderVersion": bpy.app.version_string, "renderEngine": bpy.context.scene.render.engine},
        "shot": plan["shot"],
        "warnings": plan.get("warnings", []),
        "files": {key: {"path": str(output / name), "exists": (output / name).exists()} for key, name in plan["outputs"].items()},
    }
    save_json(output / plan["outputs"]["state"], state)
    print(f"AILIN_BLENDER_COMPLETE={output}", flush=True)


if __name__ == "__main__":
    main()
