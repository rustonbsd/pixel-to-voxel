import bpy
import os
import sys
import json
import math
from mathutils import Matrix

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1 :]
else:
    argv = []

import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True, help="output directory")
parser.add_argument("--start", type=int, default=None, help="start frame")
parser.add_argument("--end", type=int, default=None, help="end frame")
parser.add_argument("--step", type=int, default=1, help="frame step")
parser.add_argument("--imgfmt", default="PNG", choices=["PNG", "OPEN_EXR", "JPEG"])
args = parser.parse_args(argv)

out_dir = os.path.abspath(args.out)
img_dir = os.path.join(out_dir, "images")
os.makedirs(img_dir, exist_ok=True)

scene = bpy.context.scene
render = scene.render
render.image_settings.file_format = args.imgfmt

# Optional: make color management predictable for grayscale use
scene.display_settings.display_device = "sRGB"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0

# Frame range
start = args.start if args.start is not None else scene.frame_start
end = args.end if args.end is not None else scene.frame_end
step = max(1, args.step)

# Collect cameras
cams = [obj for obj in bpy.data.objects if obj.type == "CAMERA"]
cams.sort(key=lambda o: o.name_full)  # deterministic order
if not cams:
    raise RuntimeError("No cameras found in the scene.")

def deg(x):
    return x * 180.0 / math.pi

def get_intrinsics(scene, cam_obj):
    cam = cam_obj.data
    # Resolution and pixel aspect
    scale = render.resolution_percentage / 100.0
    width = int(render.resolution_x * scale)
    height = int(render.resolution_y * scale)
    pixel_aspect = render.pixel_aspect_x / render.pixel_aspect_y

    f_mm = cam.lens
    sensor_width = cam.sensor_width
    sensor_height = cam.sensor_height
    fit = cam.sensor_fit  # 'AUTO'|'HORIZONTAL'|'VERTICAL'

    if fit == 'VERTICAL':
        s_u = width / sensor_width / pixel_aspect
        s_v = height / sensor_height
    else:  # 'HORIZONTAL' or 'AUTO'
        s_u = width / sensor_width
        s_v = height / sensor_height * pixel_aspect

    fx = f_mm * s_u
    fy = f_mm * s_v
    cx = width * 0.5
    cy = height * 0.5

    K = [fx, 0.0, cx,
         0.0, fy, cy,
         0.0, 0.0, 1.0]
    # Blender's cam.data.angle is the current fit FOV in radians
    fov_deg = deg(cam.angle)
    return width, height, K, fov_deg

def get_extrinsics(cam_obj):
    # camera.matrix_world maps from camera local to world.
    # Camera looks along its -Z local axis.
    M_wc = cam_obj.matrix_world.copy()
    R_wc = M_wc.to_3x3()
    t_wc = M_wc.to_translation()
    # World -> Camera:
    R_cw = R_wc.transposed()
    t_cw = -(R_cw @ t_wc)
    # Flatten row-major
    R_wc_row = [R_wc[i][j] for i in range(3) for j in range(3)]
    R_cw_row = [R_cw[i][j] for i in range(3) for j in range(3)]
    t_cw_list = [t_cw.x, t_cw.y, t_cw.z]
    pos = [t_wc.x, t_wc.y, t_wc.z]
    return R_wc_row, R_cw_row, t_cw_list, pos

def decompose_yaw_pitch_roll_for_cpp(R_wc):
    # Your C++ expects rotation = Rz(yaw) * Ry(roll) * Rx(pitch)
    # with yaw about Z, pitch about X, roll about Y.
    # We decompose world rotation R_wc into those angles.
    # Build 3x3 Matrix from row-major list:
    R = Matrix(((R_wc[0], R_wc[1], R_wc[2]),
                (R_wc[3], R_wc[4], R_wc[5]),
                (R_wc[6], R_wc[7], R_wc[8])))
    # We want angles (yaw_z, roll_y, pitch_x) such that:
    # R ≈ Rz(yaw) * Ry(roll) * Rx(pitch)
    # mathutils doesn’t directly decompose to mixed-axis order,
    # so we solve from the matrix terms (standard Z-Y-X style with swapped labels).
    # For R = Rz * Ry * Rx, one set of formulas is:
    # pitch_x = atan2(-R[1][2], R[2][2])
    # roll_y  = asin(R[0][2])
    # yaw_z   = atan2(-R[0][1], R[0][0])
    # Guard asin domain
    r02 = R[0][2]
    r12 = R[1][2]
    r22 = R[2][2]
    r01 = R[0][1]
    r00 = R[0][0]
    r02_clamped = max(-1.0, min(1.0, float(r02)))
    roll_y = math.asin(r02_clamped)
    pitch_x = math.atan2(-float(r12), float(r22))
    yaw_z = math.atan2(-float(r01), float(r00))
    return deg(yaw_z), deg(pitch_x), deg(roll_y)

metadata = []
for frame in range(start, end + 1, step):
    scene.frame_set(frame)
    for cam_idx, cam in enumerate(cams):
        # Render
        scene.camera = cam
        img_name = f"{cam.name}_{frame:06d}.png"
        img_path = os.path.join(img_dir, img_name)
        render.filepath = img_path
        bpy.ops.render.render(write_still=True)

        # Calib + poses
        width, height, K, fov_deg = get_intrinsics(scene, cam)
        R_wc_row, R_cw_row, t_cw, cam_pos = get_extrinsics(cam)
        yaw_deg, pitch_deg, roll_deg = decompose_yaw_pitch_roll_for_cpp(R_wc_row)

        entry = {
            "camera_index": cam_idx,
            "frame_index": frame,
            "image_file": os.path.join("images", img_name),
            "image_size": [width, height],
            "camera_position": cam_pos,                  # world XYZ
            "fov_degrees": fov_deg,                      # matches Blender fit
            "yaw": yaw_deg,                              # about Z
            "pitch": pitch_deg,                          # about X
            "roll": roll_deg,                            # about Y
            "rotation_matrix_world": R_wc_row,           # row-major, world rotation of camera
            "extrinsics_world_to_cam": {
                "R": R_cw_row,                           # row-major
                "t": t_cw                                # so X_cam = R * X_world + t
            },
            "intrinsics_K": K                            # row-major
        }
        metadata.append(entry)

# Save JSON
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "metadata.json"), "w") as f:
    json.dump(metadata, f, indent=2)
print(f"Wrote {len(metadata)} entries to {os.path.join(out_dir, 'metadata.json')}")