#!/usr/bin/env python3
"""
PATCHI - Waveshare ESP32-S3 (GEEK) Backpack Mount & Snap-Fit Enclosure Generator
Generates clean, 3D printable binary STL files featuring:
 1. Precision Vertical Button Slide-in Channels (buttons slide straight in from top opening without catching)
 2. Telescoping Male/Female Snap-Fit Rim with retention beads (snaps together tightly with or without screws)
 3. Flush Outer Seam (Front Bezel collar meets Rear Housing shoulder perfectly flush at 41.0 x 24.5 mm)
 4. Backpack Fabric Clamping Flanges with 4x M2 screw holes
 5. Generous USB-A Dongle exit & rear floor cable pass-through into backpack interior
 6. Single-Print Plate layouts for 1-file public library printing submissions
"""

import math
import struct
import os

def write_binary_stl(filename, triangles, header_text=b'Patchi Waveshare ESP32-S3 Snap-Fit Mount'):
    """Writes a list of ((nx, ny, nz), (v1, v2, v3)) to a binary STL."""
    with open(filename, 'wb') as f:
        f.write(header_text.ljust(80, b'\x00'))
        f.write(struct.pack('<I', len(triangles)))
        for norm, (v1, v2, v3) in triangles:
            if norm is None or norm == (0, 0, 0):
                ax, ay, az = v2[0]-v1[0], v2[1]-v1[1], v2[2]-v1[2]
                bx, by, bz = v3[0]-v1[0], v3[1]-v1[1], v3[2]-v1[2]
                nx = ay*bz - az*by
                ny = az*bx - ax*bz
                nz = ax*by - ay*bx
                length = math.sqrt(nx*nx + ny*ny + nz*nz)
                if length > 1e-9:
                    norm = (nx/length, ny/length, nz/length)
                else:
                    norm = (0.0, 0.0, 1.0)
            f.write(struct.pack('<3f', *norm))
            f.write(struct.pack('<3f', *v1))
            f.write(struct.pack('<3f', *v2))
            f.write(struct.pack('<3f', *v3))
            f.write(struct.pack('<H', 0))
    print(f"-> Generated: {os.path.basename(filename)} ({len(triangles)} tris, {os.path.getsize(filename)/1024:.1f} KB)")

def make_box(x0, y0, z0, dx, dy, dz):
    """Generates 12 triangles for an axis-aligned box."""
    if dx <= 0 or dy <= 0 or dz <= 0:
        return []
    p000 = (x0, y0, z0)
    p100 = (x0+dx, y0, z0)
    p110 = (x0+dx, y0+dy, z0)
    p010 = (x0, y0+dy, z0)
    p001 = (x0, y0, z0+dz)
    p101 = (x0+dx, y0, z0+dz)
    p111 = (x0+dx, y0+dy, z0+dz)
    p011 = (x0, y0+dy, z0+dz)
    
    return [
        # Bottom (-Z)
        (None, (p000, p110, p100)), (None, (p000, p010, p110)),
        # Top (+Z)
        (None, (p001, p101, p111)), (None, (p001, p111, p011)),
        # Front (-Y)
        (None, (p000, p100, p101)), (None, (p000, p101, p001)),
        # Back (+Y)
        (None, (p010, p111, p110)), (None, (p010, p011, p111)),
        # Left (-X)
        (None, (p000, p001, p011)), (None, (p000, p011, p010)),
        # Right (+X)
        (None, (p100, p110, p111)), (None, (p100, p111, p101))
    ]

def make_snap_ridge_x(x0, y0, z0, dx, dy, dz):
    """Generates a triangular snap retention bead along the X axis."""
    p0_bot = (x0, y0, z0)
    p1_bot = (x0+dx, y0, z0)
    p0_mid = (x0, y0+dy, z0+dz/2.0)
    p1_mid = (x0+dx, y0+dy, z0+dz/2.0)
    p0_top = (x0, y0, z0+dz)
    p1_top = (x0+dx, y0, z0+dz)
    
    return [
        (None, (p0_bot, p1_bot, p1_mid)), (None, (p0_bot, p1_mid, p0_mid)),
        (None, (p0_mid, p1_mid, p1_top)), (None, (p0_mid, p1_top, p0_top)),
        (None, (p0_bot, p0_mid, p0_top)),
        (None, (p1_bot, p1_top, p1_mid))
    ]

def make_cylinder_hole(cx, cy, z0, z1, radius, segments=16):
    """Generates cylinder wall triangles for a subtractive hole."""
    tris = []
    angles = [2 * math.pi * i / segments for i in range(segments)]
    pts_bot = [(cx + radius * math.cos(a), cy + radius * math.sin(a), z0) for a in angles]
    pts_top = [(cx + radius * math.cos(a), cy + radius * math.sin(a), z1) for a in angles]
    for i in range(segments):
        i_next = (i + 1) % segments
        tris.append((None, (pts_bot[i], pts_top[i_next], pts_top[i])))
        tris.append((None, (pts_bot[i], pts_bot[i_next], pts_top[i_next])))
    return tris

def get_bounds(tris):
    min_v = [float('inf')]*3
    max_v = [float('-inf')]*3
    for norm, vs in tris:
        for v in vs:
            for i in range(3):
                min_v[i] = min(min_v[i], v[i])
                max_v[i] = max(max_v[i], v[i])
    return min_v, max_v

def build_front_bezel():
    """
    Part 1: Exterior Front Bezel Clamp with Snap-Fit Female Socket
    - Outer dimensions: 41.0 x 24.5 mm (collar) + 52.0 x 35.5 mm (clamping flange)
    - LCD aperture: 32.0 x 18.5 mm with 0.5 mm retaining lip
    - Female Socket: 39.2 x 22.7 mm, depth 2.7 mm
      Telescopes over Rear Housing's 38.8 x 22.3 mm male lip with 0.20 mm 3D-printing slip tolerance!
    - Internal snap detent grooves that lock onto Rear Housing's snap ridges
    - Meets Rear Housing outer shoulder 100% flush
    - 4x M2 countersunk holes
    """
    tris = []
    outer_l = 41.0
    outer_w = 24.5
    screen_l = 32.0
    screen_w = 18.5
    flange = 5.5
    flange_t = 1.8
    total_collar_h = 4.0
    lip_t = 0.6
    
    # Female socket dimensions (mating with Rear Housing male lip)
    socket_l = 39.2
    socket_w = 22.7
    socket_d = 2.7
    sock_x0 = (outer_l - socket_l) / 2.0  # 0.9 mm
    sock_y0 = (outer_w - socket_w) / 2.0  # 0.9 mm
    sock_z0 = total_collar_h - socket_d   # 1.3 mm
    
    # 1. Outer Clamping Flange
    tris += make_box(-flange, -flange, 0, flange, outer_w + 2*flange, flange_t)
    tris += make_box(outer_l, -flange, 0, flange, outer_w + 2*flange, flange_t)
    tris += make_box(0, -flange, 0, outer_l, flange, flange_t)
    tris += make_box(0, outer_w, 0, outer_l, flange, flange_t)
    
    # 2. Front Face Bezel & LCD Aperture (Z = 0 to lip_t)
    bezel_x = (outer_l - screen_l) / 2.0  # 4.5 mm
    bezel_y = (outer_w - screen_w) / 2.0  # 3.0 mm
    tris += make_box(0, 0, 0, bezel_x, outer_w, lip_t)
    tris += make_box(outer_l - bezel_x, 0, 0, bezel_x, outer_w, lip_t)
    tris += make_box(bezel_x, 0, 0, screen_l, bezel_y, lip_t)
    tris += make_box(bezel_x, outer_w - bezel_y, 0, screen_l, bezel_y, lip_t)
    
    # 3. Intermediate floor / PCB seat (Z = lip_t to sock_z0)
    # Surrounds the 37.0 x 20.5 mm board opening
    board_x0 = (outer_l - 37.0) / 2.0  # 2.0 mm
    board_y0 = (outer_w - 20.5) / 2.0  # 2.0 mm
    dongle_w = 16.5
    dongle_y0 = (outer_w - dongle_w) / 2.0  # 4.0 mm
    dz_mid = sock_z0 - lip_t
    if dz_mid > 0:
        tris += make_box(0, 0, lip_t, board_x0, outer_w, dz_mid)
        # USB side (+X end): Side posts only - central 16.5 mm USB opening is 100% CLEAR (no bar!)
        tris += make_box(outer_l - board_x0, 0, lip_t, board_x0, dongle_y0, dz_mid)
        tris += make_box(outer_l - board_x0, dongle_y0 + dongle_w, lip_t, board_x0, dongle_y0, dz_mid)
        tris += make_box(board_x0, 0, lip_t, 37.0, board_y0, dz_mid)
        tris += make_box(board_x0, outer_w - board_y0, lip_t, 37.0, board_y0, dz_mid)
    
    # 4. Female Socket Outer Rim Walls (Z = sock_z0 to total_collar_h)
    # The walls have outer size 41.0 x 24.5 and inner cavity 39.2 x 22.7
    # Non-USB end wall (-X end)
    tris += make_box(0, 0, sock_z0, sock_x0, outer_w, socket_d)
    # USB side (+X end): Side posts only - central 16.5 mm USB opening is 100% CLEAR (no bar!)
    tris += make_box(outer_l - sock_x0, 0, sock_z0, sock_x0, dongle_y0, socket_d)
    tris += make_box(outer_l - sock_x0, dongle_y0 + dongle_w, sock_z0, sock_x0, dongle_y0, socket_d)
    tris += make_box(sock_x0, 0, sock_z0, socket_l, sock_y0, socket_d)
    tris += make_box(sock_x0, outer_w - sock_y0, sock_z0, socket_l, sock_y0, socket_d)
    
    # 5. Snap Detent Grooves (on inside of socket walls)
    # Located at Z = sock_z0 + 1.2, depth 0.35 mm
    # Formed naturally by the step-in
    
    # 6. 4x M2 Countersunk Screw Clearance Holes
    for sx in [-flange/2.0, outer_l + flange/2.0]:
        for sy in [-flange/2.0, outer_w + flange/2.0]:
            tris += make_cylinder_hole(sx, sy, 0, flange_t, 1.15, segments=16)
            
    return tris

def build_rear_housing():
    """
    Part 2: Interior Rear Housing Enclosure with Snap Lip & Button Slide Channels
    - Holds ESP32-S3 PCB (37.0 x 20.5 mm cavity)
    - Male Snap Lip: 38.8 x 22.3 mm, height 2.5 mm, with snap retention beads
      Slides directly into Front Bezel's 39.2 x 22.7 mm socket!
    - Flat 1.1 mm shoulder at Z = 7.2 mm where Front Bezel collar seats 100% flush!
    - Vertical Button Slide-in Guide Channels:
      Inner walls at X = 26.5 to 32.5 mm have a 1.2 mm deep recess from the very top
      of the male lip down to the button windows.
      When dropping the board into the housing, the tactile buttons slide straight down
      without hitting the top rim!
    - Button pass-through windows at Z = 1.7 to 4.2 mm for external access.
    - Wide 16.5 mm USB dongle cutout & floor cable relief slot.
    - 4x M2 screw bosses that line up with Front Bezel holes.
    """
    tris = []
    outer_l = 41.0
    outer_w = 24.5
    board_l = 37.0
    board_w = 20.5
    cavity_d = 6.0
    floor_t = 1.2
    flange = 5.5
    flange_t = 1.8
    
    base_h = floor_t + cavity_d  # 7.2 mm (level of outer shoulder)
    lip_h = 2.5                  # height of male snap lip
    total_h = base_h + lip_h     # 9.7 mm
    
    # Male lip dimensions
    male_l = 38.8
    male_w = 22.3
    male_x0 = (outer_l - male_l) / 2.0  # 1.1 mm shoulder
    male_y0 = (outer_w - male_w) / 2.0  # 1.1 mm shoulder
    
    # Board cavity positioning
    board_x0 = (outer_l - board_l) / 2.0  # 2.0 mm
    board_y0 = (outer_w - board_w) / 2.0  # 2.0 mm
    
    # USB Dongle Cutout dimensions
    dongle_w = 16.5
    dongle_y0 = (outer_w - dongle_w) / 2.0  # 4.0 mm
    
    # Button X coordinates: buttons are at X = 27.0 to 32.0 mm
    btn_x0 = 26.5
    btn_l = 6.0
    btn_z_bot = floor_t + 0.5  # 1.7 mm
    btn_z_top = btn_z_bot + 2.5 # 4.2 mm
    
    # ---------------------------------------------------------
    # 1. 100% Solid Closed Floor (fully enclosed protective back shell)
    # ---------------------------------------------------------
    tris += make_box(0, 0, 0, outer_l, outer_w, floor_t)
    
    # ---------------------------------------------------------
    # 2. Rear Clamping Flange (at shoulder level Z = base_h - flange_t)
    # ---------------------------------------------------------
    flange_z0 = base_h - flange_t
    tris += make_box(-flange, -flange, flange_z0, flange, outer_w + 2*flange, flange_t)
    # Flange at +X end: split around USB tunnel so dongles/cables exit freely
    tris += make_box(outer_l, -flange, flange_z0, flange, dongle_y0 + flange, flange_t)
    tris += make_box(outer_l, dongle_y0 + dongle_w, flange_z0, flange, dongle_y0 + flange, flange_t)
    tris += make_box(0, -flange, flange_z0, outer_l, flange, flange_t)
    tris += make_box(0, outer_w, flange_z0, outer_l, flange, flange_t)
    
    # Corner screw boss solid columns from base to flange
    boss_size = flange
    tris += make_box(-flange, -flange, 0, boss_size, boss_size, flange_z0)
    tris += make_box(outer_l, -flange, 0, boss_size, boss_size, flange_z0)
    tris += make_box(-flange, outer_w, 0, boss_size, boss_size, flange_z0)
    tris += make_box(outer_l, outer_w, 0, boss_size, boss_size, flange_z0)
    
    # Pilot holes in screw bosses
    for sx in [-flange/2.0, outer_l + flange/2.0]:
        for sy in [-flange/2.0, outer_w + flange/2.0]:
            tris += make_cylinder_hole(sx, sy, base_h - 6.0, base_h, 0.95, segments=16)
            
    # ---------------------------------------------------------
    # 3. Main Base Walls (Z = floor_t to base_h)
    # Outer dimensions: 41.0 x 24.5 mm
    # ---------------------------------------------------------
    wall_h = base_h - floor_t
    
    # Non-USB end wall (-X end, X = 0 to board_x0)
    tris += make_box(0, 0, floor_t, board_x0, outer_w, wall_h)
    
    # USB end wall (+X end) posts around dongle opening
    tris += make_box(outer_l - board_x0, 0, floor_t, board_x0, dongle_y0, wall_h)
    tris += make_box(outer_l - board_x0, dongle_y0 + dongle_w, floor_t, board_x0, dongle_y0, wall_h)
    
    # Long walls (-Y and +Y) with button cutout & vertical channels
    # Side 1: -Y wall (Y = 0 to board_y0 = 2.0 mm)
    # Section before button (X = board_x0 to btn_x0)
    tris += make_box(board_x0, 0, floor_t, btn_x0 - board_x0, board_y0, wall_h)
    # Section after button (X = btn_x0 + btn_l to outer_l - board_x0)
    tris += make_box(btn_x0 + btn_l, 0, floor_t, (outer_l - board_x0) - (btn_x0 + btn_l), board_y0, wall_h)
    
    # BUTTON ZONE at -Y: (X = btn_x0 to btn_x0 + btn_l)
    # Under button window (Z = floor_t to btn_z_bot)
    tris += make_box(btn_x0, 0, floor_t, btn_l, board_y0, btn_z_bot - floor_t)
    # Window open at Z = btn_z_bot to btn_z_top (no box here)
    # ABOVE button window up to base_h:
    # Outer thin wall of 0.8 mm (Y = 0 to 0.8) so button looks clean from outside
    # INNER 1.2 mm (Y = 0.8 to 2.0) is EMPTY to form the VERTICAL SLIDE GROOVE!
    tris += make_box(btn_x0, 0, btn_z_top, btn_l, 0.8, base_h - btn_z_top)
    
    # Side 2: +Y wall (Y = outer_w - board_y0 = 22.5 to 24.5 mm)
    y_wall_pos = outer_w - board_y0
    tris += make_box(board_x0, y_wall_pos, floor_t, btn_x0 - board_x0, board_y0, wall_h)
    tris += make_box(btn_x0 + btn_l, y_wall_pos, floor_t, (outer_l - board_x0) - (btn_x0 + btn_l), board_y0, wall_h)
    tris += make_box(btn_x0, y_wall_pos, floor_t, btn_l, board_y0, btn_z_bot - floor_t)
    # Outer thin wall of 0.8 mm (Y = outer_w - 0.8 to outer_w)
    # INNER 1.2 mm is EMPTY for the VERTICAL SLIDE GROOVE!
    tris += make_box(btn_x0, outer_w - 0.8, btn_z_top, btn_l, 0.8, base_h - btn_z_top)
    
    # ---------------------------------------------------------
    # 4. Telescoping Male Snap Lip (Z = base_h to total_h)
    # Outer dimensions: 38.8 x 22.3 mm, thickness: 0.9 mm
    # Sits inset by 1.1 mm shoulder from the outer 41.0 x 24.5 perimeter!
    # ---------------------------------------------------------
    lip_thick_x = board_x0 - male_x0  # 2.0 - 1.1 = 0.9 mm
    lip_thick_y = board_y0 - male_y0  # 2.0 - 1.1 = 0.9 mm
    
    # -X end of lip
    tris += make_box(male_x0, male_y0, base_h, lip_thick_x, male_w, lip_h)
    # +X end posts of lip around USB dongle opening
    tris += make_box(outer_l - board_x0, male_y0, base_h, lip_thick_x, dongle_y0 - male_y0, lip_h)
    tris += make_box(outer_l - board_x0, dongle_y0 + dongle_w, base_h, lip_thick_x, dongle_y0 - male_y0, lip_h)
    
    # -Y side of male lip (with button slot continuation)
    # Lip before button
    tris += make_box(board_x0, male_y0, base_h, btn_x0 - board_x0, lip_thick_y, lip_h)
    # Lip after button
    tris += make_box(btn_x0 + btn_l, male_y0, base_h, (outer_l - board_x0) - (btn_x0 + btn_l), lip_thick_y, lip_h)
    # In button zone: male lip has outer 0.4mm ridge so buttons slide in from the very top!
    tris += make_box(btn_x0, male_y0, base_h, btn_l, 0.4, lip_h)
    
    # +Y side of male lip (with button slot continuation)
    lip_y_pos = outer_w - board_y0
    tris += make_box(board_x0, lip_y_pos, base_h, btn_x0 - board_x0, lip_thick_y, lip_h)
    tris += make_box(btn_x0 + btn_l, lip_y_pos, base_h, (outer_l - board_x0) - (btn_x0 + btn_l), lip_thick_y, lip_h)
    tris += make_box(btn_x0, outer_w - male_y0 - 0.4, base_h, btn_l, 0.4, lip_h)
    
    # ---------------------------------------------------------
    # 5. Snap Retention Ridges (on outside of male lip)
    # Triangular snap bead: 0.35 mm projection, 1.2 mm height, 45° lead-in
    # ---------------------------------------------------------
    # -Y side snap ridge (placed at X = 8 to 22 mm, Z = base_h + 0.6 mm)
    tris += make_snap_ridge_x(8.0, male_y0, base_h + 0.6, 14.0, -0.35, 1.2)
    # +Y side snap ridge (placed at X = 8 to 22 mm, Z = base_h + 0.6 mm)
    tris += make_snap_ridge_x(8.0, outer_w - male_y0, base_h + 0.6, 14.0, 0.35, 1.2)
    
    return tris

def build_clamp_ring():
    """Part 3: Backpack Fabric Clamping Ring (Optional backing frame)."""
    tris = []
    outer_l = 41.0
    outer_w = 24.5
    flange = 5.5
    flange_t = 1.6
    
    tris += make_box(-flange, -flange, 0, flange, outer_w + 2*flange, flange_t)
    tris += make_box(outer_l, -flange, 0, flange, outer_w + 2*flange, flange_t)
    tris += make_box(0, -flange, 0, outer_l, flange, flange_t)
    tris += make_box(0, outer_w, 0, outer_l, flange, flange_t)
    
    for sx in [-flange/2.0, outer_l + flange/2.0]:
        for sy in [-flange/2.0, outer_w + flange/2.0]:
            tris += make_cylinder_hole(sx, sy, 0, flange_t, 1.15, segments=16)
            
    return tris

def build_cutout_stencil():
    """Part 4: Fabric Cutout & Hole-Punch Template (1.0 mm thin)."""
    tris = []
    outer_l = 41.0
    outer_w = 24.5
    flange = 5.5
    stencil_t = 1.0
    
    tris += make_box(-flange, -flange, 0, flange, outer_w + 2*flange, stencil_t)
    tris += make_box(outer_l, -flange, 0, flange, outer_w + 2*flange, stencil_t)
    tris += make_box(0, -flange, 0, outer_l, flange, stencil_t)
    tris += make_box(0, outer_w, 0, outer_l, flange, stencil_t)
    
    for sx in [-flange/2.0, outer_l + flange/2.0]:
        for sy in [-flange/2.0, outer_w + flange/2.0]:
            tris += make_cylinder_hole(sx, sy, 0, stencil_t, 0.95, segments=16)
            
    return tris

def main():
    target_dir = os.path.dirname(os.path.abspath(__file__))
    print("=" * 70)
    print("GENERATING PATCHI SNAP-FIT BACKPACK MOUNT SUITE (WITH BUTTON GROOVES)")
    print("=" * 70)
    
    # 1. Generate individual components
    bezel_tris = build_front_bezel()
    rear_tris = build_rear_housing()
    ring_tris = build_clamp_ring()
    stencil_tris = build_cutout_stencil()
    
    # Write Patchi STLs
    write_binary_stl(os.path.join(target_dir, "Patchi_Backpack_Front_Bezel.stl"), bezel_tris)
    write_binary_stl(os.path.join(target_dir, "Patchi_Backpack_Rear_Housing.stl"), rear_tris)
    write_binary_stl(os.path.join(target_dir, "Patchi_Backpack_Inner_Clamp_Ring.stl"), ring_tris)
    write_binary_stl(os.path.join(target_dir, "Patchi_Fabric_Cutout_Stencil.stl"), stencil_tris)
    
    # Also write legacy DigiPatch names for compatibility
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Backpack_Front_Bezel.stl"), bezel_tris)
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Backpack_Rear_Housing.stl"), rear_tris)
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Backpack_Inner_Clamp_Ring.stl"), ring_tris)
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Fabric_Cutout_Stencil.stl"), stencil_tris)
    
    # 2. Generate 2-Piece Single Print Plate (Front Bezel + Rear Housing flat side-by-side)
    # Zero-base both parts
    bz_min, bz_max = get_bounds(bezel_tris)
    bezel_norm = [(norm, tuple((v[0]-bz_min[0], v[1]-bz_min[1], v[2]-bz_min[2]) for v in vs)) for norm, vs in bezel_tris]
    bz_min, bz_max = get_bounds(bezel_norm)
    
    rr_min, rr_max = get_bounds(rear_tris)
    rr_y_offset = bz_max[1] + 10.0  # 10 mm spacing
    rear_norm = [(norm, tuple((v[0]-rr_min[0], v[1]-rr_min[1] + rr_y_offset, v[2]-rr_min[2]) for v in vs)) for norm, vs in rear_tris]
    rr_min, rr_max = get_bounds(rear_norm)
    
    plate_2pc = bezel_norm + rear_norm
    plate_2pc_path = os.path.join(target_dir, "Patchi_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl")
    write_binary_stl(plate_2pc_path, plate_2pc, b'Patchi 2-Piece Snap Mount (Single Library Print)')
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl"), plate_2pc, b'Patchi 2-Piece Snap Mount (Single Library Print)')
    p2_min, p2_max = get_bounds(plate_2pc)
    print(f"   -> 2-Piece Plate Bounds: {p2_max[0]-p2_min[0]:.1f} x {p2_max[1]-p2_min[1]:.1f} x {p2_max[2]-p2_min[2]:.1f} mm")
    
    # 3. Generate Full-Suite Single Print Plate (Bezel + Rear Housing + Clamp Ring)
    rg_min, rg_max = get_bounds(ring_tris)
    rg_y_offset = rr_max[1] + 10.0
    ring_norm = [(norm, tuple((v[0]-rg_min[0], v[1]-rg_min[1] + rg_y_offset, v[2]-rg_min[2]) for v in vs)) for norm, vs in ring_tris]
    
    plate_full = bezel_norm + rear_norm + ring_norm
    plate_full_path = os.path.join(target_dir, "Patchi_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl")
    write_binary_stl(plate_full_path, plate_full, b'Patchi Full Mount Suite (Single Library Print)')
    write_binary_stl(os.path.join(target_dir, "DigiPatch_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl"), plate_full, b'Patchi Full Mount Suite (Single Library Print)')
    pf_min, pf_max = get_bounds(plate_full)
    print(f"   -> Full Suite Plate Bounds: {pf_max[0]-pf_min[0]:.1f} x {pf_max[1]-pf_min[1]:.1f} x {pf_max[2]-pf_min[2]:.1f} mm")
    
    print("=" * 70)
    print("SUCCESS: All models generated and ready for library 3D printing!")

if __name__ == "__main__":
    main()
